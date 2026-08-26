ADORE APARTMENTS DIRECT BOOKING WEBSITE

Public website:
https://flori992.github.io/adore-apartments-website/

Private website panel:
https://flori992.github.io/adore-apartments-website/admin.html

The website is connected to Supabase for:
- Authorized email/password access
- Public property content
- Multiple property images in Storage
- Locations, descriptions, amenities and standard prices
- Manual date closures and date-specific prices
- Website settings and authorized-user management

Availability connection:
- Each website listing is mapped to one StayFlow property.
- StayFlow reservations automatically create sanitized busy periods for the website.
- Booking.com/imported calendar events automatically create the same sanitized busy periods.
- The public website receives only property IDs and blocked date ranges. It cannot read guest names, phone numbers, notes, expenses or other private management information.

The public website does not show an Admin link. Authorized users open admin.html directly and sign in.

Direct booking flow:
- Guests choose dates, enter their full name, email, phone, guest count and an optional message.
- Cash bookings are confirmed immediately and added to the StayFlow reservations calendar as unpaid Direct bookings.
- Card bookings hold the dates for 30 minutes and open Stripe Checkout for the exact database-calculated amount.
- A verified Stripe webhook creates the paid Direct reservation; the browser success page is not trusted for confirmation.

Stripe setup (secrets must never be committed to this repository):
1. In Supabase Edge Function secrets, add STRIPE_SECRET_KEY from the Stripe account.
2. In Stripe Workbench, add a webhook endpoint for:
   https://mrukzyqaztgkdgbqshzk.supabase.co/functions/v1/stripe-webhook
3. Subscribe it to checkout.session.completed and checkout.session.expired.
4. Add the endpoint signing secret to Supabase as STRIPE_WEBHOOK_SECRET.
