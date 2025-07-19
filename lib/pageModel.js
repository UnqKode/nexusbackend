import mongoose from "mongoose";

const PriceSchema = new mongoose.Schema({
  tokenAddress: {
    type: String,
    required: [true, "Token address is required"],
  },
  network: {
    type: String,
    required: [true, "Network is required"],
  },
  date: {
    type: Date,
    required: [true, "Date is required"],
    default: Date.now,
  },
  price: {
    type: String,
    required: [true, "Price is required"],
  },
});

const PriceModel = mongoose.models.Price || mongoose.model("Price", PriceSchema);

export default PriceModel;
