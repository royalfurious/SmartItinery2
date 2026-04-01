import { Request, Response } from 'express';
import { budgetIntelligenceService } from '../services/budget-intelligence.service';

export const getBudgetIntelligence = async (req: Request, res: Response) => {
  try {
    const {
      source,
      destination,
      startDate,
      endDate,
      passengers,
    } = req.body || {};

    if (!destination || !startDate || !endDate) {
      return res.status(400).json({
        error: 'destination, startDate, and endDate are required',
      });
    }

    const payload = {
      source,
      destination,
      startDate,
      endDate,
      passengers,
    };

    const result = await budgetIntelligenceService.getLiveBudgetIntelligence(payload);

    return res.json({
      ok: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Budget intelligence error:', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to compute budget intelligence',
      details: error?.message || 'unknown error',
    });
  }
};

export const getHotelLivePrices = async (req: Request, res: Response) => {
  try {
    const {
      destination,
      checkInDate,
      checkOutDate,
      adults,
      hotelName,
    } = req.body || {};

    if (!destination || !checkInDate || !checkOutDate) {
      return res.status(400).json({
        error: 'destination, checkInDate, and checkOutDate are required',
      });
    }

    const data = await budgetIntelligenceService.getHotelLivePrices({
      destination,
      checkInDate,
      checkOutDate,
      adults,
      hotelName,
    });

    return res.json({ ok: true, data });
  } catch (error: any) {
    console.error('Hotel live pricing error:', error?.message || error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch live hotel prices',
      details: error?.message || 'unknown error',
    });
  }
};
