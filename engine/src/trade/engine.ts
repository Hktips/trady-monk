import fs from "fs";
import { RedisManager } from "../RedisManager";
import { ORDER_UPDATE, TRADE_ADDED } from "../types/index";
import { CANCEL_ORDER, CREATE_ORDER, GET_DEPTH, GET_OPEN_ORDERS, MessageFromApi, ON_RAMP } from "../types/fromApi";
import { Fill, Order, Orderbook } from "./Orderbook";

//TODO: Avoid floats everywhere, use a decimal similar to the PayTM project for every currency
export const BASE_CURRENCY = "INR";

interface UserBalance {
    [key: string]: {
        available: number;
        locked: number;
    }
}

export class Engine {
    private orderbooks: Orderbook[] = [];
    private balances: Map<string, UserBalance> = new Map();

    constructor() {
        let snapshot = null
        try {
            if (process.env.WITH_SNAPSHOT) {
                snapshot = fs.readFileSync("./snapshot.json");
            }
        } catch (e) {
            console.log("No snapshot found");
        }

        if (snapshot) {
            const snapshotSnapshot = JSON.parse(snapshot.toString());
            this.orderbooks = snapshotSnapshot.orderbooks.map((o: any) => new Orderbook(o.baseAsset, o.bids, o.asks, o.lastTradeId, o.currentPrice));
            this.balances = new Map(snapshotSnapshot.balances);
        } else {
            this.orderbooks = [new Orderbook(`TATA`, [], [], 0, 0)];
            this.setBaseBalances();
        }
        setInterval(() => {
            this.saveSnapshot();
        }, 1000 * 3);
    }
    saveSnapshot(){
        const snapshotSnapshot={
            this.orderbooks:this.orderbooks.map(o=> o.getSnapshot()),
            this.balances:Array.from(this.balances.entries());
        }
        fs.writerFlileSync("./snapshot.json",JSON.stringify(snapshotSnapshot));

    }
    process({message,clientId}:{message:MessageFromApi,clientId:string}){
        switch(message.type){
            case CREATE_ORDER:
                try{
                    RedisManager.getInstance().sendToApi(clientId,{
                        type:"ORDER_PLACED",
                        payload:{
                            orderId,
                            executedQty,
                            fills
                        }
                    });
                }catch(e){
                    console.log(e);
                    RadisManager.getInstance().sendToApi(clientId,{
                        type:"ORDER_REJECTED",
                        payload:{
                            orderId:"",
                            executedQty:0,
                            remainingQty:0
                
                        }
                    });
                }
                break;
                case CANCEL_ORDER:
                    try{
                        const orderId=message.data.orderId;
                        const cancelMarket=message.data.market;
                        const cancelMakerOrder=this.orderbooks.find(o=>o.ticker()===cancelMarket);
                        if(!cancelOrderbook){
                            throw new Error("No orderbook fount");
                        }
                        const order=cancelMakerOrder?.asks.find(o=>o.orderId===orderId)|| cancelOrderbook.bids.find(o=>o.orderId===orderId);  \
                        if(!order){
                            console.log("No order found");
                            throw new Error("No order found");
                        }
                        if (order.side === "buy") {
                            const price = cancelOrderbook.cancelBid(order)
                            const leftQuantity = (order.quantity - order.filled) * order.price;
                            //@ts-ignore
                            this.balances.get(order.userId)[BASE_CURRENCY].available += leftQuantity;
                            //@ts-ignore
                            this.balances.get(order.userId)[BASE_CURRENCY].locked -= leftQuantity;
                            if (price) {
                                this.sendUpdatedDepthAt(price.toString(), cancelMarket);
                            }
                        } else {
                            const price = cancelOrderbook.cancelAsk(order)
                            const leftQuantity = order.quantity - order.filled;
                            //@ts-ignore
                            this.balances.get(order.userId)[quoteAsset].available += leftQuantity;
                            //@ts-ignore
                            this.balances.get(order.userId)[quoteAsset].locked -= leftQuantity;
                            if (price) {
                                this.sendUpdatedDepthAt(price.toString(), cancelMarket);
                            }
                        }
                        RedisManager.getInstance().sendToApi(clientId,{
                            type:"ORDER_CANCELLED",
                            payload:{
                                orderId,
                                executedQty:0,
                                remainingQty:0
                            }
                        });
                    }catch(e){
                        console.log("Error while cancelling order",e);
                    }
                    break;
                    case GET_OPEN_ORDERS:
                        try{
                            const openOrderbook=this.orderbooks.find(o=>o.ticker()==message.data.market);
                            if(!openOrderbook){
                                throw new Error("No orderbook found");

                            }
                            const openOrders=openOrderbook.getOpenOrders(message.data.userId);
                            RedisManager.getInstance().sendToApi(clientId,{
                                type:"OPEN_ORDERS",
                                payload:openOrders
                            });
                        }catch(e){
                                console.log(e);
                            }
                            break;
                            case ON_RAMP:
                                const userId = message.data.userId;
                                const amount =Number(message.data.amount) ;
                                this.onRamp(userId,amount);
                                break;
                                case GET_DEPTH:
                                    try{
                                        const market = message.data.market;
                                        const orderbook=this.orderbooks.find(o=>o.ticker()===market);
                                        if(!orderbook){
                                            throw new Error("No orderbook found");
                                        }
                                        RedisManager.getInstance().sendToApi(clientId,{
                                            type:"DEPTH",
                                            payload:orderbook.getDepth()
                                        });
                                    }catch(e){
                                        RedisManager.getInstance().sendToApi(clientId,{
                                            type:"DEPTH",
                                            payload:{
                                                bids:[],
                                                asks:[]
                                            }
                                        })
                                    }
                                    break;
                                    
                                }
                            }

                            addOrderbook(orderbook:Orderbook){
                            this.orderbooks.push(orderbook);
                            }

                              
                    createOrder(market:string,price:string,quantity:string,side:"buy"|"sell",userId:string){
                        const orderbook=this.orderbooks.find(o=>o.ticker()===market);
                        const baseAsset=market.split("-")[0];
                        const quoteAsset=market.split("-")[1];
                        if(!orderbook){
                            throw new Error("No orderbook found");
                        }
                        this.checkAndLockFunds(baseAsset,quoteAsset,side,userId,quoteAsset,price,quantity);
                        const order:Order={
                            price:Number(price),
                            quantity:Number(quantity),
                            orderId:Math.random().toString(36).substring(2,15)+Math.random().toString(36).substring(2,15),
                            filled:0,
                            side,
                            userId
                        }
                        const {fills,executedQty}=orderbook.addOrder(order);
                        this.updateBalances(userId,baseAsset,quoteAsset,side,fills,executedQty);
                        this.creatDbTrades(fills,market,userId);
                        this.UpdateDbOrders(order,executedQty,fills,market);
                        this.publishWsDepthUpdates(fills,price,side,market);
                        this.PublishWsTrades(fills,userId,market);
                        retrun{executedQty,fills,orderId:order.orderId};


                    }
                    updateDbOrders(order:Order,executedQty:number,fills:fills:Fill[],market:string){
                        RedisManager.getInstance().pushMessage({
                            type:ORDER_UPDATE,
                            data:{
                                orderId:order.orderId,
                                executedQty:executedQty,
                                market:market,
                                price:order.price.toString(),
                                quantity:order.quantity.toString(),


                        });
                        fills.forEach(fill=>{
                            RedisManager.getInstance().pushMessage({
                                type:ORDER_UPDATE,
                                data:{
                                    orderId:fill.markrOrderId,
                                    executedQty:fill
                                }
                            })
                        })
                    }
                    createDbTrades(fills:Fill[],market:string,userId:string){
                        fills.forEarch(fill=>{
                            RedisManager.getInstance().pushMessage({
                                type:TRADE_ADDED,
                                data:{
                                    market:market,
                                    id:fill.tradeId.toString(),
                                    isBuyerMaker:fill.otherUserId===userId,
                                    price:fill.price,
                                    quantity:fill.qty.toString(),
                                    quoteQuantity:(fill.price*Number(fill.price)).toString(),
                                    timestamp:Date.now()
                                }
                            })
                        })
                    }
                    publishWsTrades(fills: Fill[], userId: string, market: string) {
                        fills.forEach(fill => {
                            RedisManager.getInstance().publishMessage(`trade@${market}`, {
                                stream: `trade@${market}`,
                                data: {
                                    e: "trade",
                                    t: fill.tradeId,
                                    m: fill.otherUserId === userId, // TODO: Is this right?
                                    p: fill.price,
                                    q: fill.qty.toString(),
                                    s: market,
                                }
                            });
                        });
                    }
                    sendUpdatedDepthAt(price: string, market: string) {
                        const orderbook = this.orderbooks.find(o => o.ticker() === market);
                        if (!orderbook) {
                            return;
                        }
                        const depth = orderbook.getDepth();
                        const updatedBids = depth?.bids.filter(x => x[0] === price);
                        const updatedAsks = depth?.asks.filter(x => x[0] === price);
                        
                        RedisManager.getInstance().publishMessage(`depth@${market}`, {
                            stream: `depth@${market}`,
                            data: {
                                a: updatedAsks.length ? updatedAsks : [[price, "0"]],
                                b: updatedBids.length ? updatedBids : [[price, "0"]],
                                e: "depth"
                            }
                        });
                    }
    publisWsDepthUpdates(fills: Fill[], price: string, side: "buy" | "sell", market: string) {
        const orderbook = this.orderbooks.find(o => o.ticker() === market);
        if (!orderbook) {
            return;
        }
        const depth = orderbook.getDepth();
        if (side === "buy") {
            const updatedAsks = depth?.asks.filter(x => fills.map(f => f.price).includes(x[0].toString()));
            const updatedBid = depth?.bids.find(x => x[0] === price);
            console.log("publish ws depth updates")
            RedisManager.getInstance().publishMessage(`depth@${market}`, {
                stream: `depth@${market}`,
                data: {
                    a: updatedAsks,
                    b: updatedBid ? [updatedBid] : [],
                    e: "depth"
                }
            });
        } 
        if (side === "sell") {
           const updatedBids = depth?.bids.filter(x => fills.map(f => f.price).includes(x[0].toString()));
           const updatedAsk = depth?.asks.find(x => x[0] === price);
           console.log("publish ws depth updates")
           RedisManager.getInstance().publishMessage(`depth@${market}`, {
               stream: `depth@${market}`,
               data: {
                   a: updatedAsk ? [updatedAsk] : [],
                   b: updatedBids,
                   e: "depth"
               }
           });
        }
    }
    updateBalance(userId: string, baseAsset: string, quoteAsset: string, side: "buy" | "sell", fills: Fill[], executedQty: number) {
        if (side === "buy") {
            fills.forEach(fill => {
                // Update quote asset balance
                //@ts-ignore
                this.balances.get(fill.otherUserId)[quoteAsset].available = this.balances.get(fill.otherUserId)?.[quoteAsset].available + (fill.qty * fill.price);

                //@ts-ignore
                this.balances.get(userId)[quoteAsset].locked = this.balances.get(userId)?.[quoteAsset].locked - (fill.qty * fill.price);

                // Update base asset balance

                //@ts-ignore
                this.balances.get(fill.otherUserId)[baseAsset].locked = this.balances.get(fill.otherUserId)?.[baseAsset].locked - fill.qty;

                //@ts-ignore
                this.balances.get(userId)[baseAsset].available = this.balances.get(userId)?.[baseAsset].available + fill.qty;

            });
            
        } else {
            fills.forEach(fill => {
                // Update quote asset balance
                //@ts-ignore
                this.balances.get(fill.otherUserId)[quoteAsset].locked = this.balances.get(fill.otherUserId)?.[quoteAsset].locked - (fill.qty * fill.price);

                //@ts-ignore
                this.balances.get(userId)[quoteAsset].available = this.balances.get(userId)?.[quoteAsset].available + (fill.qty * fill.price);

                // Update base asset balance

                //@ts-ignore
                this.balances.get(fill.otherUserId)[baseAsset].available = this.balances.get(fill.otherUserId)?.[baseAsset].available + fill.qty;

                //@ts-ignore
                this.balances.get(userId)[baseAsset].locked = this.balances.get(userId)?.[baseAsset].locked - (fill.qty);

            });
        }
    }

                
 }
        