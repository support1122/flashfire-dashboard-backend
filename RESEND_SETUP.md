# Resend Email Setup for FlashFire Dashboard

## Quick Setup

### 1. Create .env file
Create a `.env` file in your project root with:

```env
# Database Configuration
MONGODB_URI=your_mongodb_connection_string

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here

# Resend Configuration
RESEND_API_KEY=re_E5Vx6XvV_DakAD4SLnWGSptb1oAY6VebS
RESEND_FROM_EMAIL=FlashFire <onboarding@resend.dev>

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 2. Test the Setup
Run your server and test the OTP system:

```bash
npm start
```

## API Endpoints

### Register (Sends OTP)
```bash
curl -X POST http://localhost:3000/register \
-H "Content-Type: application/json" \
-d '{"email":"your-email@example.com","name":"Your Name","password":"password123"}'
```

### Verify OTP
```bash
curl -X POST http://localhost:3000/verify-otp \
-H "Content-Type: application/json" \
-d '{"email":"your-email@example.com","otp":"123456","name":"Your Name","password":"password123"}'
```

### Resend OTP
```bash
curl -X POST http://localhost:3000/resend-otp \
-H "Content-Type: application/json" \
-d '{"email":"your-email@example.com","name":"Your Name"}'
```

## Features
- ✅ 6-digit OTP generation
- ✅ 10-minute expiration
- ✅ One-time use
- ✅ Automatic cleanup
- ✅ Beautiful email templates
- ✅ Resend functionality

## Troubleshooting
1. Check your email inbox (and spam folder)
2. Verify the API key is correct
3. Ensure your MongoDB is running
4. Check server logs for any errors



