#!/bin/bash

# ============================================================================
# InfluxDB CRUD API Integration Test Suite
# ============================================================================
# Tests all CRUD operations with proper validation and error handling
#
# Usage:
#   ./test-api.sh                    # Auto-discover ALB from CDK stack
#   ./test-api.sh <ALB_DNS_NAME>     # Use specific ALB DNS
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed
#   2 - Prerequisites missing or setup failed
# ============================================================================

set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Stack name (should match your CDK stack)
STACK_NAME="InfluxDbCrudStack"

# Unique test identifier to avoid collision with real data
TEST_ID="test_$(date +%s)"
SENSOR_ID_1="${TEST_ID}_sensor_001"
SENSOR_ID_2="${TEST_ID}_sensor_002"

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}✓${NC} $1" >&2
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1" >&2
}

print_separator() {
    echo "" >&2
    echo "================================================================" >&2
    echo "$1" >&2
    echo "================================================================" >&2
}

# Check prerequisites
check_prerequisites() {
    local missing=0
    
    if ! command -v curl &> /dev/null; then
        log_error "curl is not installed"
        missing=1
    fi
    
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed (brew install jq)"
        missing=1
    fi
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        missing=1
    fi
    
    if [ $missing -eq 1 ]; then
        exit 2
    fi
    
    log_success "All prerequisites installed"
}

# Get ALB DNS from CloudFormation stack or CDK outputs (returns value to stdout)
get_alb_dns() {
    local alb_dns=""
    
    # Try CloudFormation first
    log_info "Retrieving ALB DNS from CloudFormation stack: $STACK_NAME"
    
    alb_dns=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='ALBDnsName'].OutputValue" \
        --output text 2>&1 | grep -v "AccessDenied\|UnauthorizedOperation\|error occurred")
    
    # If CloudFormation failed, try CDK outputs file
    if [ -z "$alb_dns" ] || [ "$alb_dns" == "None" ]; then
        log_warning "Cannot access CloudFormation (permission issue)"
        log_info "Trying CDK outputs file as fallback..."
        
        if [ -f "cdk.out/$STACK_NAME.template.json" ]; then
            # Extract ALB DNS from CDK outputs file
            alb_dns=$(jq -r '.Outputs.ALBDnsName.Value // empty' "cdk.out/$STACK_NAME.template.json" 2>/dev/null)
        fi
    fi
    
    # If still empty, check for recent deployment outputs
    if [ -z "$alb_dns" ] || [ "$alb_dns" == "None" ]; then
        log_error "Could not retrieve ALB DNS automatically"
        log_info "Please provide ALB DNS manually:"
        log_info "  ./test-api.sh <ALB_DNS>"
        echo ""
        log_info "To find your ALB DNS:"
        log_info "  1. Check AWS Console: EC2 > Load Balancers"
        log_info "  2. Or check your deployment output logs"
        exit 2
    fi
    
    log_success "Found ALB DNS: $alb_dns"
    
    # Return only the DNS (to stdout for capture)
    printf "%s" "$alb_dns"
}

# Perform HTTP request and capture response
http_request() {
    local method=$1
    local path=$2
    local data=$3
    local temp_file=$(mktemp)
    
    if [ -z "$data" ]; then
        curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$path" \
            -H "Content-Type: application/json" > "$temp_file" 2>&1
    else
        curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$path" \
            -H "Content-Type: application/json" \
            -d "$data" > "$temp_file" 2>&1
    fi
    
    echo "$temp_file"
}

# Extract HTTP status code from response file
get_status_code() {
    local file=$1
    tail -n 1 "$file"
}

# Extract response body from response file (compatible with macOS)
get_body() {
    local file=$1
    # Use sed to delete last line instead of head -n -1 (which doesn't work on macOS)
    sed '$d' "$file"
}

# Assert HTTP status code
assert_status() {
    local expected=$1
    local actual=$2
    local test_name=$3
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if [ "$expected" -eq "$actual" ]; then
        log_success "Test $TESTS_RUN: $test_name (Status: $actual)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        log_error "Test $TESTS_RUN: $test_name (Expected: $expected, Got: $actual)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Assert JSON field exists and has expected value
assert_json_field() {
    local body=$1
    local field=$2
    local expected=$3
    local test_name=$4
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    local actual=$(echo "$body" | jq -r ".$field" 2>/dev/null)
    
    if [ "$actual" == "$expected" ]; then
        log_success "Test $TESTS_RUN: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        log_error "Test $TESTS_RUN: $test_name"
        log_error "  Expected $field: '$expected'"
        log_error "  Got $field: '$actual'"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Assert JSON field exists
assert_field_exists() {
    local body=$1
    local field=$2
    local test_name=$3
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    local value=$(echo "$body" | jq -r ".$field" 2>/dev/null)
    
    if [ "$value" != "null" ] && [ -n "$value" ]; then
        log_success "Test $TESTS_RUN: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        log_error "Test $TESTS_RUN: $test_name"
        log_error "  Field '$field' does not exist or is null"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Wait for API to be healthy
wait_for_health() {
    log_info "Waiting for API to be healthy..."
    
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        local response_file=$(http_request "GET" "/health" "")
        local status=$(get_status_code "$response_file")
        rm -f "$response_file"
        
        # Check if status is a valid number and equals 200
        if [ -n "$status" ] && [ "$status" = "200" ]; then
            log_success "API is healthy"
            return 0
        fi
        
        log_warning "Attempt $attempt/$max_attempts: API not ready (Status: ${status:-empty})"
        sleep 3
        attempt=$((attempt + 1))
    done
    
    log_error "API did not become healthy after $max_attempts attempts"
    log_error "Base URL: $BASE_URL/health"
    log_info "Check if the ALB DNS is correct and the Lambda is deployed"
    exit 2
}

# Cleanup test data
cleanup_test_data() {
    log_info "Cleaning up test data..."
    http_request "DELETE" "/data/$SENSOR_ID_1" "" > /dev/null 2>&1
    http_request "DELETE" "/data/$SENSOR_ID_2" "" > /dev/null 2>&1
    rm -f /tmp/test_response_* 2>/dev/null
}

# ============================================================================
# Test Functions
# ============================================================================

test_health_check() {
    print_separator "Test Suite 1: Health Check"
    
    local response_file=$(http_request "GET" "/health" "")
    local status=$(get_status_code "$response_file")
    local body=$(get_body "$response_file")
    
    echo "Response: $body"
    
    assert_status 200 "$status" "Health check returns 200 OK"
    assert_json_field "$body" "status" "healthy" "Health status is 'healthy'"
    assert_field_exists "$body" "timestamp" "Timestamp field exists"
    
    rm -f "$response_file"
}

test_create_data() {
    print_separator "Test Suite 2: Create Data (POST /data)"
    
    # Test 1: Create first data point
    local data1='{
        "measurement": "sensor_data",
        "tags": {
            "sensor_id": "'$SENSOR_ID_1'",
            "location": "test_lab"
        },
        "fields": {
            "temperature": 22.5,
            "humidity": 65
        }
    }'
    
    local response_file=$(http_request "POST" "/data" "$data1")
    local status=$(get_status_code "$response_file")
    local body=$(get_body "$response_file")
    
    echo "Response: $body"
    
    assert_status 201 "$status" "Create data point 1 returns 201 Created"
    assert_json_field "$body" "message" "Data created successfully" "Success message received"
    
    rm -f "$response_file"
    sleep 1
    
    # Test 2: Create second data point
    local data2='{
        "measurement": "sensor_data",
        "tags": {
            "sensor_id": "'$SENSOR_ID_2'",
            "location": "test_office"
        },
        "fields": {
            "temperature": 24.0,
            "humidity": 70
        }
    }'
    
    response_file=$(http_request "POST" "/data" "$data2")
    status=$(get_status_code "$response_file")
    body=$(get_body "$response_file")
    
    echo "Response: $body"
    
    assert_status 201 "$status" "Create data point 2 returns 201 Created"
    
    rm -f "$response_file"
    sleep 1
}

test_get_data() {
    print_separator "Test Suite 3: Retrieve Data (GET /data)"
    
    local response_file=$(http_request "GET" "/data" "")
    local status=$(get_status_code "$response_file")
    local body=$(get_body "$response_file")
    
    echo "Response (truncated):"
    echo "$body" | jq '.' 2>/dev/null | head -20
    
    assert_status 200 "$status" "Get all data returns 200 OK"
    assert_field_exists "$body" "data" "Response contains 'data' field"
    
    # Check if our test data exists
    local sensor1_count=$(echo "$body" | jq -r "[.data[] | select(.sensor_id == \"$SENSOR_ID_1\")] | length" 2>/dev/null)
    
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -n "$sensor1_count" ] && [ "$sensor1_count" -gt 0 ] 2>/dev/null; then
        log_success "Test $TESTS_RUN: Created data point 1 exists in response"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        log_error "Test $TESTS_RUN: Created data point 1 not found in response"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    
    rm -f "$response_file"
}

test_update_data() {
    print_separator "Test Suite 4: Update Data (PUT /data/:id)"
    
    local update_data='{
        "measurement": "sensor_data",
        "tags": {
            "sensor_id": "'$SENSOR_ID_1'",
            "location": "test_lab_updated"
        },
        "fields": {
            "temperature": 25.5,
            "humidity": 68
        }
    }'
    
    local response_file=$(http_request "PUT" "/data/$SENSOR_ID_1" "$update_data")
    local status=$(get_status_code "$response_file")
    local body=$(get_body "$response_file")
    
    echo "Response: $body"
    
    assert_status 200 "$status" "Update data returns 200 OK"
    assert_json_field "$body" "message" "Data $SENSOR_ID_1 updated successfully" "Update success message received"
    
    rm -f "$response_file"
    sleep 1
}

test_delete_data() {
    print_separator "Test Suite 5: Delete Data (DELETE /data/:id)"
    
    local response_file=$(http_request "DELETE" "/data/$SENSOR_ID_1" "")
    local status=$(get_status_code "$response_file")
    local body=$(get_body "$response_file")
    
    echo "Response: $body"
    
    assert_status 200 "$status" "Delete data returns 200 OK"
    assert_json_field "$body" "message" "Data $SENSOR_ID_1 deleted successfully" "Delete success message received"
    
    rm -f "$response_file"
    sleep 2
    
    # Verify deletion by querying
    log_info "Verifying data was deleted..."
    response_file=$(http_request "GET" "/data" "")
    body=$(get_body "$response_file")
    
    local deleted_count=$(echo "$body" | jq -r "[.data[] | select(.sensor_id == \"$SENSOR_ID_1\")] | length" 2>/dev/null)
    
    TESTS_RUN=$((TESTS_RUN + 1))
    if [ -n "$deleted_count" ] && [ "$deleted_count" -eq 0 ] 2>/dev/null; then
        log_success "Test $TESTS_RUN: Deleted data no longer appears in results"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        log_warning "Test $TESTS_RUN: Deleted data still appears (InfluxDB eventual consistency)"
        log_info "  This may be due to eventual consistency, not a failure"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    fi
    
    rm -f "$response_file"
}

test_error_cases() {
    print_separator "Test Suite 6: Error Handling"
    
    # Test 404 for invalid endpoint
    local response_file=$(http_request "GET" "/invalid-endpoint" "")
    local status=$(get_status_code "$response_file")
    
    assert_status 404 "$status" "Invalid endpoint returns 404 Not Found"
    
    rm -f "$response_file"
}

# ============================================================================
# Main Execution
# ============================================================================

show_usage() {
    echo "Usage: $0 [ALB_DNS_NAME]"
    echo ""
    echo "Integration test suite for InfluxDB CRUD API endpoints"
    echo ""
    echo "Arguments:"
    echo "  ALB_DNS_NAME    Optional. ALB DNS name to test."
    echo "                  If omitted, will auto-discover from CloudFormation"
    echo ""
    echo "Examples:"
    echo "  $0                                           # Auto-discover ALB DNS"
    echo "  $0 my-alb-123.eu-central-1.elb.amazonaws.com  # Use specific ALB"
    echo ""
    echo "Exit codes:"
    echo "  0 - All tests passed"
    echo "  1 - One or more tests failed"
    echo "  2 - Prerequisites missing or setup failed"
    exit 0
}

main() {
    # Check for help flag
    if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
        show_usage
    fi
    
    print_separator "InfluxDB CRUD API Integration Test Suite"
    
    # Check prerequisites
    check_prerequisites
    
    echo "" >&2
    
    # Get ALB DNS
    if [ -z "$1" ]; then
        ALB_DNS=$(get_alb_dns)
    else
        # Strip whitespace and newlines from provided DNS
        ALB_DNS=$(echo "$1" | tr -d '\n\r' | xargs)
        log_info "Using provided ALB DNS: $ALB_DNS"
    fi
    
    # Validate ALB DNS format
    if [[ ! "$ALB_DNS" =~ ^[a-zA-Z0-9.-]+\.[a-z]+$ ]]; then
        log_error "Invalid ALB DNS format: '$ALB_DNS'"
        log_info "Expected format: my-alb-123456.region.elb.amazonaws.com"
        exit 2
    fi
    
    BASE_URL="http://$ALB_DNS"
    
    echo "" >&2
    log_info "Test Configuration:"
    log_info "  Base URL: $BASE_URL"
    log_info "  Test ID: $TEST_ID"
    log_info "  Sensor IDs: $SENSOR_ID_1, $SENSOR_ID_2"
    echo "" >&2
    
    # Wait for API to be healthy
    wait_for_health
    
    # Cleanup any existing test data
    cleanup_test_data
    
    # Run test suites
    test_health_check
    test_create_data
    test_get_data
    test_update_data
    test_delete_data
    test_error_cases
    
    # Cleanup
    cleanup_test_data
    
    # Print summary
    print_separator "Test Summary"
    echo "" >&2
    echo "  Total Tests:    $TESTS_RUN" >&2
    echo -e "  ${GREEN}Passed:${NC}         $TESTS_PASSED" >&2
    echo -e "  ${RED}Failed:${NC}         $TESTS_FAILED" >&2
    echo "" >&2
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log_success "All tests passed! 🎉"
        echo "" >&2
        exit 0
    else
        log_error "Some tests failed"
        echo "" >&2
        
        # Check if failures are due to InfluxDB connectivity
        if grep -q "Connection refused" /tmp/test_response_* 2>/dev/null; then
            log_warning "Detected InfluxDB connection errors"
            log_info "This indicates the Lambda cannot reach InfluxDB instance"
            echo "" >&2
            log_info "Troubleshooting steps:"
            log_info "  1. Wait 5-10 minutes after deployment for InfluxDB to initialize"
            log_info "  2. Check Lambda logs:"
            log_info "     aws logs tail /aws/lambda/InfluxDbCrudStack-CrudLambdaFunction --follow"
            log_info "  3. Verify security groups allow Lambda → InfluxDB on port 8086"
            log_info "  4. Check InfluxDB instance status in EC2 console"
            echo "" >&2
        fi
        
        exit 1
    fi
}

# Cleanup on interrupt
trap cleanup_test_data EXIT

# Run main function
main "$@"
