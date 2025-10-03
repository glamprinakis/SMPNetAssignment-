#!/bin/bash

# Test script for CRUD API endpoints
# Usage: ./test-api.sh <ALB_DNS_NAME>

if [ -z "$1" ]; then
  echo "Usage: ./test-api.sh <ALB_DNS_NAME>"
  echo "Example: ./test-api.sh my-alb-123456.us-east-1.elb.amazonaws.com"
  exit 1
fi

ALB_DNS=$1
BASE_URL="http://$ALB_DNS"

echo "================================================"
echo "Testing CRUD API at: $BASE_URL"
echo "================================================"
echo ""

# Test 1: Health Check
echo "Test 1: Health Check"
echo "GET /health"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" "$BASE_URL/health" | jq '.'
echo ""
sleep 2

# Test 2: Create Data Point
echo "================================================"
echo "Test 2: Create Data Point"
echo "POST /data"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" -X POST "$BASE_URL/data" \
  -H "Content-Type: application/json" \
  -d '{
    "measurement": "sensor_data",
    "tags": {
      "sensor_id": "test_sensor_001",
      "location": "lab"
    },
    "fields": {
      "temperature": 22.5,
      "humidity": 65
    }
  }' | jq '.'
echo ""
sleep 2

# Test 3: Create Another Data Point
echo "================================================"
echo "Test 3: Create Another Data Point"
echo "POST /data"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" -X POST "$BASE_URL/data" \
  -H "Content-Type: application/json" \
  -d '{
    "measurement": "sensor_data",
    "tags": {
      "sensor_id": "test_sensor_002",
      "location": "office"
    },
    "fields": {
      "temperature": 24.0,
      "humidity": 70
    }
  }' | jq '.'
echo ""
sleep 2

# Test 4: Get All Data
echo "================================================"
echo "Test 4: Get All Data"
echo "GET /data"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" "$BASE_URL/data" | jq '.'
echo ""
sleep 2

# Test 5: Update Data Point
echo "================================================"
echo "Test 5: Update Data Point"
echo "PUT /data/test_sensor_001"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" -X PUT "$BASE_URL/data/test_sensor_001" \
  -H "Content-Type: application/json" \
  -d '{
    "measurement": "sensor_data",
    "tags": {
      "sensor_id": "test_sensor_001",
      "location": "lab"
    },
    "fields": {
      "temperature": 25.5,
      "humidity": 68
    }
  }' | jq '.'
echo ""
sleep 2

# Test 6: Delete Data Point
echo "================================================"
echo "Test 6: Delete Data Point"
echo "DELETE /data/test_sensor_001"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" -X DELETE "$BASE_URL/data/test_sensor_001" | jq '.'
echo ""
sleep 2

# Test 7: Get Data After Delete
echo "================================================"
echo "Test 7: Get Data After Delete"
echo "GET /data"
echo "---"
curl -s -w "\nStatus: %{http_code}\n" "$BASE_URL/data" | jq '.'
echo ""

echo "================================================"
echo "All tests completed!"
echo "================================================"
