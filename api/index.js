const { createClient } = require("@supabase/supabase-js");

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Use service role key for server writes
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --------------------
// Initiate Payment
// --------------------
app.post("/api/initiate-payment", async (req, res) => {
  try {
    const { name, email, phone, location, programType, amount } = req.body;

    // Call Centiiv API
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
      {
        headers: { Authorization: `Bearer ${CENTIIV_API_KEY}` },
      }
    );

    if (!response.data?.success) {
      return res.status(500).json({ success: false, message: "Centiiv API error" });
    }

    const paymentData = response.data.data;

    // Save registration to Supabase
    const { error } = await supabase
      .from("registrations")
      .insert([
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

    if (error) {
      console.error("Supabase insert error:", error.message);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    res.json({
      success: true,
      paymentUrl: paymentData.link,
    });

    console.log("Centiiv initiated payment:", paymentData);
  } catch (error) {
    console.error("Initiation error:", error.response?.data || error.message);
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

    let normalizedStatus = "pending";
    const eventType = event.event?.toLowerCase();
    if (eventType.includes("success")) normalizedStatus = "success";
    else if (eventType.includes("fail")) normalizedStatus = "failed";

    // Update Supabase
    const { error } = await supabase
      .from("registrations")
      .update({ status: normalizedStatus, paid_at: new Date().toISOString() })
      .eq("payment_id", paymentId);

    if (error) console.error("Supabase update error:", error.message);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(500);
  }
});

// --------------------
// Fetch Registrations (Admin)
// --------------------
app.get("/api/registrations", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ success: true, registrations: data });
  } catch (err) {
    console.error("Fetch registrations error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch registrations" });
  }
});
