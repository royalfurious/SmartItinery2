import { Router } from 'express';
import { getBudgetIntelligence, getHotelLivePrices } from '../controllers/budget.controller';

const router = Router();

/**
 * POST /api/budget/intelligence
 * Body: { source?, destination, startDate, endDate, passengers? }
 *
 * Returns live accommodation and local transport reference rates in INR
 * using external providers with TTL caching and fallback policies.
 */
router.post('/intelligence', getBudgetIntelligence);

/**
 * POST /api/budget/hotel-live-prices
 * Body: { destination, checkInDate, checkOutDate, adults?, hotelName? }
 *
 * Returns live room offers in INR from Amadeus for the selected hotel/destination.
 */
router.post('/hotel-live-prices', getHotelLivePrices);

export default router;
