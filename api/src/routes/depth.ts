import express from "express";
const app=express();
app.use(express.json());



app.listen(3000,()=>{
    console.log("server lister on port 3000");
})



