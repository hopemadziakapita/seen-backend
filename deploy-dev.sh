#!/usr/bin/env bash
# Seen backend — DEVELOPMENT deployment script.
# Provisions: resource group, storage account, Application Insights,
# a Linux Consumption Function App, an Azure OpenAI resource + model
# deployment, a Key Vault holding the Azure OpenAI key, and a Cosmos DB
# account with per-user partitioned storage.
#
# This is the CHEAP deployment — no VNet, no private endpoints, no App
# Gateway. All services use public endpoints with key-based auth.
# Suitable for demos and local development.
#
# For the HIPAA-compliant production setup with VNet isolation, private
# endpoints, and WAF, use deploy-production.sh instead.
#
# Edit the variables below, then run: bash deploy-dev.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Configuration — edit these before running
# ---------------------------------------------------------------------------
RESOURCE_GROUP="seen-backend-rg-dev"
LOCATION="eastus2"

SUFFIX_FILE=".deploy-suffix-development"
if [ -f "$SUFFIX_FILE" ]; then
  SUFFIX=$(cat "$SUFFIX_FILE")
else
  SUFFIX="$RANDOM"
  echo "$SUFFIX" > "$SUFFIX_FILE"
fi

STORAGE_ACCOUNT="seenbackendsa${SUFFIX}"
FUNCTION_APP="seen-backend-func-${SUFFIX}"
APP_INSIGHTS="seen-backend-ai-${SUFFIX}"
KEY_VAULT="seen-backend-kv-${SUFFIX}"

COSMOS_ACCOUNT="seen-backend-cosmos-${SUFFIX}"
COSMOS_DATABASE="seen-db"
COSMOS_CONTAINER="entries"

AOAI_ACCOUNT="seen-backend-aoai-${SUFFIX}"
AOAI_DEPLOYMENT="gpt-5-mini"
AOAI_MODEL="gpt-5-mini"
AOAI_MODEL_VERSION="2025-08-07"
AOAI_SKU="GlobalStandard"
AOAI_CAPACITY="10"

NODE_VERSION="22"

echo "=== DEVELOPMENT deployment (no VNet, no App Gateway) ==="
echo "Resource group:  $RESOURCE_GROUP"
echo "Function App:    $FUNCTION_APP"
echo "Storage account: $STORAGE_ACCOUNT"
echo "Key Vault:       $KEY_VAULT"
echo "Cosmos DB:       $COSMOS_ACCOUNT"
echo "Azure OpenAI:    $AOAI_ACCOUNT (deployment: $AOAI_DEPLOYMENT)"
echo

# ---------------------------------------------------------------------------
# 2. Resource group
# ---------------------------------------------------------------------------
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# ---------------------------------------------------------------------------
# 3. Storage account — Functions runtime storage
# ---------------------------------------------------------------------------
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --output none

# ---------------------------------------------------------------------------
# 4. Application Insights
# ---------------------------------------------------------------------------
az monitor app-insights component create \
  --app "$APP_INSIGHTS" \
  --location "$LOCATION" \
  --resource-group "$RESOURCE_GROUP" \
  --application-type web \
  --output none

# ---------------------------------------------------------------------------
# 5. Function App — Linux, Node 22, Consumption plan
# ---------------------------------------------------------------------------
az functionapp create \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-account "$STORAGE_ACCOUNT" \
  --consumption-plan-location "$LOCATION" \
  --runtime node \
  --runtime-version "$NODE_VERSION" \
  --functions-version 4 \
  --os-type Linux \
  --app-insights "$APP_INSIGHTS" \
  --output none

# ---------------------------------------------------------------------------
# 6. Azure OpenAI resource + model deployment
# ---------------------------------------------------------------------------
az cognitiveservices account create \
  --name "$AOAI_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --kind OpenAI \
  --sku S0 \
  --yes \
  --output none

az cognitiveservices account deployment create \
  --name "$AOAI_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --deployment-name "$AOAI_DEPLOYMENT" \
  --model-name "$AOAI_MODEL" \
  --model-version "$AOAI_MODEL_VERSION" \
  --model-format OpenAI \
  --sku-name "$AOAI_SKU" \
  --sku-capacity "$AOAI_CAPACITY" \
  --output none

AOAI_ENDPOINT=$(az cognitiveservices account show \
  --name "$AOAI_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query properties.endpoint -o tsv)

AOAI_KEY=$(az cognitiveservices account keys list \
  --name "$AOAI_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query key1 -o tsv)

# ---------------------------------------------------------------------------
# 7. Key Vault — store the Azure OpenAI key as a secret
# ---------------------------------------------------------------------------
az keyvault create \
  --name "$KEY_VAULT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --enable-rbac-authorization false \
  --output none

az keyvault secret set \
  --vault-name "$KEY_VAULT" \
  --name "AzureOpenAIApiKey" \
  --value "$AOAI_KEY" \
  --output none

AOAI_SECRET_URI=$(az keyvault secret show \
  --vault-name "$KEY_VAULT" --name "AzureOpenAIApiKey" \
  --query "id" -o tsv)

# ---------------------------------------------------------------------------
# 8. Cosmos DB — NoSQL API, per-user partitioned container
# ---------------------------------------------------------------------------
az cosmosdb create \
  --name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --locations regionName="$LOCATION" failoverPriority=0 \
  --default-consistency-level Session \
  --enable-free-tier true \
  --output none

az cosmosdb sql database create \
  --account-name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$COSMOS_DATABASE" \
  --output none

az cosmosdb sql container create \
  --account-name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "$COSMOS_DATABASE" \
  --name "$COSMOS_CONTAINER" \
  --partition-key-path "/userId" \
  --throughput 400 \
  --output none

COSMOS_ENDPOINT=$(az cosmosdb show \
  --name "$COSMOS_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query documentEndpoint -o tsv)

COSMOS_KEY=$(az cosmosdb keys list \
  --name "$COSMOS_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query primaryMasterKey -o tsv)

# Store the Cosmos key in Key Vault too
az keyvault secret set \
  --vault-name "$KEY_VAULT" \
  --name "CosmosKey" \
  --value "$COSMOS_KEY" \
  --output none

COSMOS_SECRET_URI=$(az keyvault secret show \
  --vault-name "$KEY_VAULT" --name "CosmosKey" \
  --query "id" -o tsv)

# ---------------------------------------------------------------------------
# 9. Grant the Function App's managed identity read access to Key Vault
# ---------------------------------------------------------------------------
az functionapp identity assign \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --output none

PRINCIPAL_ID=$(az functionapp identity show \
  --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" \
  --query principalId -o tsv)

az keyvault set-policy \
  --name "$KEY_VAULT" \
  --object-id "$PRINCIPAL_ID" \
  --secret-permissions get list \
  --output none

# ---------------------------------------------------------------------------
# 10. App settings — secrets via Key Vault references
# ---------------------------------------------------------------------------
az functionapp config appsettings set \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    "AZURE_OPENAI_ENDPOINT=$AOAI_ENDPOINT" \
    "AZURE_OPENAI_API_VERSION=2024-10-21" \
    "AZURE_OPENAI_DEPLOYMENT=$AOAI_DEPLOYMENT" \
    "AZURE_OPENAI_API_KEY=@Microsoft.KeyVault(SecretUri=$AOAI_SECRET_URI)" \
    "COSMOS_ENDPOINT=$COSMOS_ENDPOINT" \
    "COSMOS_KEY=@Microsoft.KeyVault(SecretUri=$COSMOS_SECRET_URI)" \
    "COSMOS_DATABASE=$COSMOS_DATABASE" \
    "COSMOS_CONTAINER=$COSMOS_CONTAINER" \
    "SCM_DO_BUILD_DURING_DEPLOYMENT=false" \
  --output none

# ---------------------------------------------------------------------------
# 11. Build + deploy code
# ---------------------------------------------------------------------------
npm install
npm run build
npm prune --omit=dev
rm -f release.zip
zip -rq release.zip dist host.json package.json package-lock.json node_modules -x '*.map'

az functionapp deployment source config-zip \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --src release.zip

npm install

# ---------------------------------------------------------------------------
# 12. Restart + print connection info
# ---------------------------------------------------------------------------
az functionapp restart --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP"
echo "Waiting 30s for the app to finish restarting..."
sleep 30

FUNCTION_KEY=$(az functionapp keys list \
  --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" \
  --query "functionKeys.default" -o tsv)

echo
echo "=========================================================================="
echo "Deployed (DEVELOPMENT mode — no VNet, public endpoints)."
echo "Base URL:     https://${FUNCTION_APP}.azurewebsites.net/api"
echo "Function key: ${FUNCTION_KEY}"
echo
echo "Try it:"
echo "  curl \"https://${FUNCTION_APP}.azurewebsites.net/api/health\""
echo "  curl \"https://${FUNCTION_APP}.azurewebsites.net/api/profiles?code=${FUNCTION_KEY}\""
echo "=========================================================================="
