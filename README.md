# Tweb Shop CRM

Order management, delivery tracking, and customer follow-up CRM for Tweb Shop.

## Setup

1. Clone this repo
2. Run `npm install`
3. Run `npm run dev` to start locally
4. Deploy to Vercel by connecting this GitHub repo

## Supabase

The app connects to Supabase for the database. The project URL and key are in `src/App.jsx`.

Run the `supabase-schema.sql` in your Supabase SQL Editor to create the tables.

## Features

- CSV import from WPForms (auto-detects Nigeria/Ghana format)
- Order status management with WhatsApp message generation
- Delivery agent tracking with performance metrics
- Inventory management (stock per agent)
- Revenue, delivery fees, and net remittance tracking
- Mobile-first responsive design
- Multi-device access (auto-syncs every 30 seconds)
