// pages/api/chat.js (Vercel serverless function)
// Author: Tajwar

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  const allowedOrigin = "https://matihaat.com";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ status: "Chat proxy running ✅" });

  // -------------------------------
  // Fetch all Shopify products
  // -------------------------------
  async function fetchAllProducts() {
    const allProducts = [];
    let url = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-07/products.json?limit=50`;

    while (url) {
      const response = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_KEY,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        console.error("Shopify API error:", response.statusText);
        break;
      }

      const data = await response.json();
      allProducts.push(...data.products);

      const link = response.headers.get("link");
      if (link && link.includes('rel="next"')) {
        const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : null;
      } else {
        url = null;
      }
    }

    return allProducts.map(p => ({
      id: p.id,
      title: p.title,
      description: p.body_html || "",
      price: p.variants?.[0]?.price,
      url: `https://${process.env.SHOPIFY_STORE_DOMAIN}/products/${p.handle}`,
    }));
  }

  // -------------------------------
  // Compute cosine similarity
  // -------------------------------
  function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
  }

  // -------------------------------
  // Handle POST chat request
  // -------------------------------
  if (req.method === "POST") {
    try {
      const { message, conversation = [] } = req.body;

      if (!message || message.trim() === "")
        return res.status(400).json({ error: "Message is required" });

      if (!process.env.OPENAI_API_KEY)
        return res.status(500).json({ error: "OpenAI API key missing!" });

      // Fetch products
      const products = await fetchAllProducts();

      // Generate embeddings for all products
      const productEmbeddingsRes = await Promise.all(
        products.map(async (p) => {
          const embRes = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: `${p.title} ${p.description}`,
          });
          return { ...p, embedding: embRes.data[0].embedding };
        })
      );

      // Generate embedding for user query
      const queryEmbeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: message,
      });
      const queryEmbedding = queryEmbeddingRes.data[0].embedding;

      // Compute similarity and select top 5 relevant products
      const productsWithScore = productEmbeddingsRes.map((p) => ({
        ...p,
        score: cosineSimilarity(p.embedding, queryEmbedding),
      }));

      const relevantProducts = productsWithScore
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);

      // Build system prompt
      let systemPrompt = `You are Planty, the friendly AI assistant for Matihaat.com.`;

      if (relevantProducts.length > 0) {
        systemPrompt += ` Mention these products if relevant:\n\n${relevantProducts
          .map(p => `- ${p.title}: $${p.price} (View: ${p.url})`)
          .join("\n")}\n`;
      }

      systemPrompt += `Always be friendly and helpful. If unsure, suggest browsing the store.`;

      const messages = [
        { role: "system", content: systemPrompt },
        ...conversation,
        { role: "user", content: message },
      ];

      // Call OpenAI Chat API
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
      const reply = data.choices?.[0]?.message?.content || "Sorry, I don’t know.";

      return res.status(200).json({ reply });
    } catch (err) {
      console.error("Proxy error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
