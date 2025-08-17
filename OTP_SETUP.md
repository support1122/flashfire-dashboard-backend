# OTP Email Verification Setup Guide

## Overview
This implementation adds OTP-based email verification to the FlashFire Dashboard backend. Users must verify their email address before they can access the dashboard.

## Features Added

1. **OTP Generation**: 6-digit OTP sent via email
2. **Email Verification**: Users must verify email before login
3. **OTP Expiration**: OTPs expire after 10 minutes
4. **Resend OTP**: Users can request new OTP if needed
5. **Secure Storage**: OTPs are stored securely in database

## New API Endpoints

### 1. Register (Modified)
- **POST** `/register`
- Sends OTP to user's email instead of creating account immediately
- **Request Body**: `{ "email", "name", "password" }`
- **Response**: `{ "message": "OTP sent to your email for verification", "email": "user@example.com" }`

### 2. Verify OTP
- **POST** `/verify-otp`
- Verifies OTP and creates user account
- **Request Body**: `{ "email", "otp", "name", "password" }`
- **Response**: `{ "message": "Email verified successfully!", "userDetails": {...}, "token": "jwt_token" }`

### 3. Resend OTP
- **POST** `/resend-otp`
- Resends OTP if user doesn't receive it
- **Request Body**: `{ "email", "name" }`
- **Response**: `{ "message": "OTP resent successfully", "email": "user@example.com" }`

## Environment Variables Required

Create a `.env` file in your project root with the following variables:

```env
# Database Configuration
MONGODB_URI=your_mongodb_connection_string

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here

# Resend Configuration (Recommended Email Service)
RESEND_API_KEY=your_resend_api_key_here
RESEND_FROM_EMAIL=FlashFire <noreply@yourdomain.com>

# Alternative Email Services (if needed):
# Mailgun Configuration
# MAILGUN_API_KEY=your_mailgun_api_key_here
# MAILGUN_DOMAIN=your_mailgun_domain.com

# Server Configuration
PORT=3000
NODE_ENV=development
```

## Email Service Setup Options

### Option 1: Resend (Recommended - Best Value)
1. **Sign up at [resend.com](https://resend.com)**
2. **Get API Key**: Dashboard → API Keys → Create API Key
3. **Verify Domain**: Add your domain for better deliverability
4. **Free Tier**: 3,000 emails/month free
5. **Pricing**: $20/month for 50,000 emails

### Option 2: Mailgun
1. **Sign up at [mailgun.com](https://mailgun.com)**
2. **Get API Key**: Settings → API Keys
3. **Verify Domain**: Add your domain
4. **Free Tier**: 5,000 emails/month for 3 months
5. **Pricing**: $35/month for 50,000 emails

### Option 3: Brevo (Sendinblue)
1. **Sign up at [brevo.com](https://brevo.com)**
2. **Get API Key**: Settings → API Keys
3. **Verify Sender**: Add your email address
4. **Free Tier**: 300 emails/day free
5. **Pricing**: $25/month for 20,000 emails

### Option 4: Mailtrap (For Testing)
1. **Sign up at [mailtrap.io](https://mailtrap.io)**
2. **Perfect for development/testing**
3. **Free Tier**: 500 emails/month free
4. **Pricing**: $9.99/month for 5,000 emails

## Installation Steps

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Set Environment Variables**:
   - Copy the example above to `.env`
   - Fill in your actual values

3. **Start the Server**:
   ```bash
   npm start
   ```

## User Flow

1. **Registration**: User enters email, name, password
2. **OTP Sent**: System sends 6-digit OTP to user's email
3. **OTP Verification**: User enters OTP received via email
4. **Account Creation**: User account is created and email marked as verified
5. **Dashboard Access**: User can now login and access dashboard

## Security Features

- OTPs expire after 10 minutes
- OTPs can only be used once
- Email verification required before login
- JWT tokens for authenticated sessions
- Automatic cleanup of expired OTPs

## Error Handling

- Invalid/expired OTP
- Email already verified
- Email delivery failures
- Duplicate registration attempts

## Database Changes

### New Collections
- `otps`: Stores OTP codes with expiration times

### Modified Collections
- `users`: Added `isEmailVerified` and `emailVerificationToken` fields

## Testing the Implementation

1. **Register a new user**:
   ```bash
   curl -X POST http://localhost:3000/register \
   -H "Content-Type: application/json" \
   -d '{"email":"test@example.com","name":"Test User","password":"password123"}'
   ```

2. **Check email for OTP** and verify:
   ```bash
   curl -X POST http://localhost:3000/verify-otp \
   -H "Content-Type: application/json" \
   -d '{"email":"test@example.com","otp":"123456","name":"Test User","password":"password123"}'
   ```

3. **Login with verified account**:
   ```bash
   curl -X POST http://localhost:3000/login \
   -H "Content-Type: application/json" \
   -d '{"email":"test@example.com","password":"password123"}'
   ```

## Troubleshooting

1. **OTP not received**: Check API key and sender email verification
2. **Database errors**: Ensure MongoDB connection string is correct
3. **JWT errors**: Verify JWT_SECRET is set in environment variables
4. **Email delivery issues**: Check email service dashboard for delivery status

## Cost Comparison

| Service | Free Tier | Paid Plan | Best For |
|---------|-----------|-----------|----------|
| **Resend** | 3,000/month | $20/50k | Best value, modern API ✅ |
| **Mailgun** | 5k/3months | $35/50k | Reliable, enterprise |
| **Brevo** | 300/day | $25/20k | User-friendly, marketing |
| **Mailtrap** | 500/month | $10/5k | Development/testing |
