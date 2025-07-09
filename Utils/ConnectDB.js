import mongoose from "mongoose";
//connection to db ..
const Connection = () => mongoose.connect('mongodb+srv://biswajitshrm6:7DL0Lz8dxicjlXQJ@users.mt5yvfh.mongodb.net/FlashFire')
                    .then(()=>console.log("Database connected succesfully..!"))
                    .catch((e)=>console.log('Problem while connecting to db', e));

export default Connection