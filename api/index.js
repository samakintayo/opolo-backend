// --------------------
// Imports
// --------------------
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const serverless = require("serverless-http");
require("dotenv").config();

// --------------------
// App & Middleware
// --------------------
const app = express();

app.use(
  cors({
    origin: "https://opolo-global.vercel.app", // your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use(express.json()); // parse JSON bodies

// --------------------
// Supabase Setup
// --------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service role key for server-side writes
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --------------------
// Config: Centiiv API
// --------------------
const CENTIIV_API_KEY = process.env.CENTIIV_API_KEY;
const CENTIIV_BASE_URL = process.env.CENTIIV_BASE_URL;

// --------------------
// Initiate Payment
// --------------------
app.post("/api/initiate-payment", async (req, res) => {
  try {
    const { name, email, phone, location, programType, amount } = req.body;

    const response = await axios.post(
      `${CENTIIV_BASE_URL}/api/v1/payments`,
      {
        amount,
        name,
        email,
        currency: "NGN",
        note: `Payment for ${programType}`,
        callback_url: "https://opolo-global.vercel.app/payment-status",
        webhook_url: "https://opolo-api.vercel.app/webhook/payment",
        metadata: { phone, location, programType },
      },
      { headers: { Authorization: `Bearer ${CENTIIV_API_KEY}` } }
    );

    if (!response.data?.success)
      return res.status(500).json({ success: false, message: "Centiiv API error" });

    const paymentData = response.data.data;

    // Save registration to Supabase
    const { error } = await supabase.from("registrations").insert([
      {
        name,
        email,
        phone,
        location,
        program_type: programType,
        amount,
        payment_id: paymentData.id,
        status: "pending",
      },
    ]);

    if (error) throw error;

    res.json({ success: true, paymentUrl: paymentData.link });
    console.log("Centiiv payment created:", paymentData.id);
  } catch (err) {
    console.error("Initiate Payment Error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Payment initiation failed" });
  }
});

// --------------------
// Webhook: Payment
// --------------------
app.post("/webhook/payment", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());
    const paymentId = event.data.id || event.data.metadata?.resourceId?.replace("DPL-", "");
    if (!paymentId) return res.sendStatus(400);

    const status = event.event.toLowerCase().includes("success")
      ? "success"
      : event.event.toLowerCase().includes("fail")
      ? "failed"
      : "pending";

    const { error } = await supabase
      .from("registrations")
      .update({ status, paid_at: new Date().toISOString() })
      .eq("payment_id", paymentId);

    if (error) console.error("Supabase update error:", error.message);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// --------------------
// Fetch Registrations (Admin) with optional programType filter
// --------------------
app.get("/api/registrations", async (req, res) => {
  try {
    const { programType } = req.query;

    let query = supabase.from("registrations").select("*").order("created_at", { ascending: false });
    if (programType) query = query.eq("program_type", programType);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, registrations: data });
  } catch (err) {
    console.error("Fetch registrations error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch registrations." });
  }
});

// --------------------
// Serverless Export
// --------------------
module.exports = app;
module.exports.handler = serverless(app);
