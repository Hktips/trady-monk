import { Router } from "express";
import { RedisManager } from "../RedishManager";
import { CREATE_ORDER, CANCEL_ORDER, ON_RAMP, GET_OPEN_ORDERS } from "../types";
export const orderRouter = Router();
orderRouter.post("/",async(req,res)=>{
    const{market,price,quantity,side,userId}=req.body;
    const response =await RedisManager.getInstance().sendAndAwait({
        type:CREATE_ORDER,
        data:{
            market,
            price,
            quantity,
            side,
            userId
        }
    });
    res.json(response.payload);
});

orderRouter.delete("/",async(req,res)=>{
    const {orderId,market}=req.body;
    const response=await RedisManager.getInstance().sendAndAwait({
        type:CANCEL_ORDER,
        data:{
            orderId,
            market
        }
    });
    res.json(response.payload);
})