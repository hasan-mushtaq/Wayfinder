# Use Node.js 22 as the base image (supports native TS type stripping)
FROM node:22-slim

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the frontend
RUN npm run build

# Set environment variable for production
ENV NODE_ENV=production

# Cloud Run injects the PORT environment variable
# We expose 3000 as a default but the server listens on process.env.PORT
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
