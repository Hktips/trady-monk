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
                              
                    
 }
                       