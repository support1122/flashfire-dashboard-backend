#!/bin/bash

# FlashFire Dashboard Production Deployment Script
set -e

echo "🚀 Starting FlashFire Dashboard Production Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_error ".env file not found! Please create one based on env.example"
    exit 1
fi

# Load environment variables
source .env

# Validate required environment variables
required_vars=(
    "MONGODB_URI"
    "JWT_SECRET"
    "CRYPTO_AES_SECRET_SECRET_KEY"
    "VITE_API_BASE_URL"
    "VITE_CLOUDINARY_CLOUD_NAME"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        print_error "Required environment variable $var is not set!"
        exit 1
    fi
done

print_status "Environment variables validated"

# Install dependencies
print_status "Installing backend dependencies..."
cd flashfire-dashboard-backend
npm ci --only=production
cd ..

print_status "Installing frontend dependencies..."
cd flashfire-dashboard-frontend
npm ci
cd ..

# Build frontend
print_status "Building frontend..."
cd flashfire-dashboard-frontend
npm run build
cd ..

# Create logs directory
mkdir -p logs

# Deploy using Docker Compose
print_status "Starting services with Docker Compose..."
docker-compose up -d --build

# Wait for services to be healthy
print_status "Waiting for services to be healthy..."
sleep 30

# Check service health
print_status "Checking service health..."

# Check backend health
if curl -f http://localhost:8001/health > /dev/null 2>&1; then
    print_status "✅ Backend is healthy"
else
    print_error "❌ Backend health check failed"
    exit 1
fi

# Check frontend health
if curl -f http://localhost:80/ > /dev/null 2>&1; then
    print_status "✅ Frontend is healthy"
else
    print_error "❌ Frontend health check failed"
    exit 1
fi

print_status "🎉 Deployment completed successfully!"
print_status "Frontend: http://localhost:80"
print_status "Backend API: http://localhost:8001"
print_status "Health Check: http://localhost:8001/health"

echo ""
print_status "Useful commands:"
echo "  View logs: docker-compose logs -f"
echo "  Stop services: docker-compose down"
echo "  Restart services: docker-compose restart"
echo "  Update deployment: ./deploy.sh"
