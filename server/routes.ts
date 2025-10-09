import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncBricklinkData } from "./services/bricklink";
import { syncShipStationOrders } from "./services/shipstation";

export async function registerRoutes(app: Express): Promise<Server> {
  // Sync Routes
  app.post("/api/sync/bricklink/inventory", async (req, res) => {
    try {
      const result = await syncBricklinkData();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("BrickLink sync error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync BrickLink inventory",
      });
    }
  });

  app.post("/api/sync/shipstation/orders", async (req, res) => {
    try {
      const result = await syncShipStationOrders();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("ShipStation sync error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync ShipStation orders",
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
