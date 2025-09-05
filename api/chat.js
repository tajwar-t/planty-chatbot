// pages/api/chat.js
// Author: Tajwar

import storeInfo from "./data/store-info.json";

export default async function handler(req, res) {
  // -------------------------------
  // Set CORS headers
  // -------------------------------
  const allowedOrigin = "https://matihaat.com"; // Change to your live domain
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight check
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === "GET") {
    return res.status(200).json({ status: "Chat proxy running ✅" });
  }

  // -------------------------------
  // Fetch Products from Shopify
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
  // Handle POST Chat Request
  // -------------------------------
  if (req.method === "POST") {
    try {
      const { message, conversation = [] } = req.body;

      // Validate message
      if (!message || message.trim() === "") {
        return res.status(400).json({ error: "Message is required" });
      }

      // Check OpenAI key
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: "OpenAI API key missing!" });
      }

      // Fetch latest products
      const products = await fetchProductsFromShopify();

      // Build FAQ section from JSON
      const faqText = storeInfo.faqs
        .map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`)
        .join("\n");

      // -------------------------------
      // SYSTEM PROMPT: Train Organic GPT
      // -------------------------------
      const systemMessage = `
        You are Organic GPT, the AI shopping assistant for Matihaat.com.
        Always be polite, friendly, and conversational.

        Brand: ${storeInfo.brand}
        About: ${storeInfo.about}
        Mission: ${storeInfo.mission}
        Shipping Info: ${storeInfo.shipping}
        Payment Methods: ${storeInfo.payment_methods}
        Return Policy: ${storeInfo.return_policy}
        Contact: ${storeInfo.contact}

        FAQs:
        ${faqText}

        Available Products:
        ${products
          .map((p) => `- ${p.title}: $${p.price} (View: ${p.url})`)
          .join("\n")}

        If you're unsure about something, politely suggest browsing the store.
      `;

      // Prepare messages for OpenAI
      const messages = [
        { role: "system", content: systemMessage },
        ...conversation,
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

      // Extract reply
      const reply =
        data.choices?.[0]?.message?.content ||
        "Sorry, I couldn't find an answer. Please check our store.";

      // Send reply to frontend
      return res.status(200).json({ reply });
    } catch (err) {
      console.error("Proxy error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // -------------------------------
  // Method Not Allowed
  // -------------------------------
  return res.status(405).json({ error: "Method not allowed" });
}
