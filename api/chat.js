// pages/api/chat.js (Vercel serverless function)
// Author: Tajwar

export default async function handler(req, res) {
  // -------------------------------
  // Set CORS headers for every request
  // -------------------------------
  const allowedOrigin = "https://matihaat.com"; // Replace with your store URL
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Health check
  if (req.method === "GET") {
    return res.status(200).json({ status: "Chat proxy running ✅" });
  }

  // -------------------------------
  // Shopify product fetcher
  // -------------------------------
  async function fetchProductsFromShopify() {
    try {
      const response = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products.json?limit=50`,
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error("Shopify API error:", response.statusText);
        return [];
      }

      const data = await response.json();
      return data.products.map((p) => ({
        title: p.title,
        price: p.variants?.[0]?.price,
        url: `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${p.handle}`,
      }));
    } catch (err) {
      console.error("Shopify fetch error:", err);
      return [];
    }
  }

  // -------------------------------
  // Handle POST chat request
  // -------------------------------
  if (req.method === "POST") {
    try {
      const { message, conversation = [] } = req.body;

      if (!message || message.trim() === "") {
        return res.status(400).json({ error: "Message is required" });
      }

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "OpenAI API key missing!" });
      }

      if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_API_KEY) {
        console.warn("⚠️ Shopify credentials not set – Planty will answer without product data");
      }

      // Fetch latest products
      const products = await fetchProductsFromShopify();

      // -------------------------------
      // Build messages array for ChatGPT
      // -------------------------------
      const messages = [
        {
          role: "system",
          content: `You are Planty, the AI assistant for Matihaat.com. 
Always be friendly, helpful, and conversational. 
If users ask about products, here are some you can mention:\n\n${products
            .map((p) => `- ${p.title}: $${p.price} (View: ${p.url})`)
            .join("\n")}\n\nIf unsure, suggest browsing the store.`,
        },
        ...conversation, // optional previous conversation
        { role: "user", content: message },
      ];

      // -------------------------------
      // Call OpenAI API
      // -------------------------------
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
        }),
      });

      const data = await response.json();
      console.log("OpenAI API response:", data);  // 🔍 Debug
      
      const reply = data.choices?.[0]?.message?.content || "Sorry, I don’t know.";

      return res.status(200).json({ reply });
    } catch (err) {
      console.error("Proxy error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
