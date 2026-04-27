import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(bodyParser.json({ limit: "10mb" }));

  // API Route for Notifications
  app.post("/api/notify", async (req, res) => {
    const { screenshot, description, type, recipient } = req.body;

    console.log(`[Notification] Sending ${type} alert to: ${Array.isArray(recipient) ? recipient.join(", ") : recipient}`);

    try {
      if (type === "email") {
        // Basic Email Setup (requires ENV variables for real use)
        // If no credentials provided, we'll log it for now
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
          console.error("CRITICAL: EMAIL_USER or EMAIL_PASS environment variables are missing!");
          console.log("Current ENV keys available:", Object.keys(process.env).filter(k => k.includes('EMAIL')));
          return res.status(400).json({ success: false, error: "Email credentials missing on server" });
        }

        console.log(`Attempting to send email from: ${process.env.EMAIL_USER}`);
        
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
          debug: true, // Enable debug output
          logger: true // Log information to console
        });

        const mailOptions = {
          from: `"VIGIL.AI - Sistema di Sicurezza" <${process.env.EMAIL_USER}>`,
          to: recipient,
          subject: "🚨 ALLERTA SICUREZZA - Rilevamento Emergenza",
          text: `ATTENZIONE: Il sistema VIGIL.AI ha rilevato una possibile emergenza.
          
Dettagli dell'evento: ${description}

Data/Ora: ${new Date().toLocaleString('it-IT')}

In allegato trovi il fotogramma catturato al momento del rilevamento.
Controlla immediatamente il monitoraggio in diretta.`,
          attachments: [
            {
              filename: "fotogramma_emergenza.jpg",
              content: screenshot,
              encoding: "base64",
            },
          ],
        };

        await transporter.sendMail(mailOptions);
        console.log("Email sent successfully");
      } else if (type === "webhook") {
        // Implement Webhook notification logic here (Discord/Telegram)
        console.log(`Webhook notification triggered: ${description}`);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Notification error:", error);
      res.status(500).json({ success: false, error: "Failed to send notification" });
    }
  });

  // API Route to Proxy Camera Frames (Solves CORS and allows server-side fetching)
  app.get("/api/proxy-camera-frame", async (req, res) => {
    const cameraUrl = req.query.url as string;

    if (!cameraUrl) {
      return res.status(400).json({ error: "Missing camera URL" });
    }

    try {
      console.log(`[Proxy] Fetching frame from: ${cameraUrl}`);
      
      const response = await axios.get(cameraUrl, {
        responseType: 'arraybuffer',
        timeout: 12000, 
        headers: {
          'User-Agent': 'VigilAI-Security-System/1.0',
          'Accept': 'image/jpeg,image/png,image/*',
          'Cache-Control': 'no-cache'
        },
        validateStatus: (status) => status < 500
      });

      if (response.status === 401 || response.status === 403) {
        throw new Error("Accesso Negato: Controlla username e password della camera.");
      }

      if (response.status === 404) {
        throw new Error("Percorso non trovato: L'indirizzo IP è giusto ma il percorso della foto (.jpg) è sbagliato.");
      }

      const contentType = response.headers['content-type'];
      const base64Image = Buffer.from(response.data, 'binary').toString('base64');

      res.json({
        success: true,
        contentType: contentType || 'image/jpeg',
        base64: base64Image
      });
    } catch (error: any) {
      let friendlyError = error.message;
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        friendlyError = "Timeout: La camera non ha risposto entro 12 secondi. Il firewall del router sta bloccando l'accesso dall'esterno.";
      } else if (error.code === 'ECONNREFUSED') {
        friendlyError = "Connessione rifiutata: La camera è online ma non accetta connessioni su questa porta.";
      } else if (error.code === 'ENOTFOUND') {
        friendlyError = "Indirizzo non trovato: Controlla se l'IP è corretto.";
      }
      
      console.error(`[Proxy] Error fetching from ${cameraUrl}:`, friendlyError);
      res.status(500).json({ 
        success: false, 
        error: friendlyError
      });
    }
  });

  // API Route to Scan/Probe common camera paths
  app.post("/api/probe-camera", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL mancante" });

    // Try to extract base URL (remove trailing slash and common file names)
    let baseUrl = url.replace(/\/+$/, "");
    if (baseUrl.endsWith(".jpg") || baseUrl.endsWith(".cgi") || baseUrl.endsWith(".png") || baseUrl.endsWith(".snapshot")) {
      baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf("/"));
    }

    const commonPaths = [
      "/snapshot.jpg",
      "/snap.jpg",
      "/image.jpg",
      "/tmpfs/auto.jpg",
      "/cgi-bin/snapshot.cgi",
      "/onvif-http/snapshot",
      "/snapshot",
      "/cgi-bin/configManager.cgi?action=getConfig&name=Camera.Snapshot",
      "/Streaming/channels/1/picture"
    ];

    console.log(`[Probe] Scanning ${baseUrl} with common paths...`);
    
    for (const path of commonPaths) {
      const testUrl = `${baseUrl}${path}`;
      try {
        const response = await axios.get(testUrl, { 
          timeout: 4000, 
          responseType: 'arraybuffer',
          validateStatus: (s) => s === 200,
          headers: {
            'User-Agent': 'VigilAI-Probe/1.0',
            'Accept': 'image/*'
          }
        });
        
        const contentType = response.headers['content-type'];
        if (contentType?.includes('image')) {
          return res.json({ 
            success: true, 
            workingUrl: testUrl,
            message: `Trovato! Percorso valido: ${path}`
          });
        }
      } catch (e) {
        // Continue to next path
      }
    }

    res.json({ 
      success: false, 
      error: "Nessun percorso immagine standard trovato. Controlla che l'IP e la porta siano corretti e che il router permetta l'accesso." 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GuardianAI Server running on http://localhost:${PORT}`);
  });
}

startServer();
