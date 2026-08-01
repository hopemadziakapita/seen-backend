#!/usr/bin/env bash
# Seen backend — PRODUCTION (HIPAA-compliant) deployment script.
#
# ⚠️  WARNING: This provisions resources that cost ~$470/month:
#   • Elastic Premium EP1 Function App (~$220/mo)
#   • Application Gateway WAF v2 (~$250/mo)
#   • Cosmos DB (free tier if available, otherwise ~$25/mo at 400 RU/s)
#   • Private endpoints + DNS zones (negligible)
#
# Architecture:
#   Internet → App Gateway (WAF v2, public IP) → Function App (private, VNet-integrated)
#   Function App → [via VNet] → Cosmos DB (private endpoint)
#   Function App → [via VNet] → Key Vault (private endpoint)
#   Function App → [via VNet] → Storage Account (private endpoint)
#
# For the cheap development deployment, use deploy-dev.sh instead.
#
# Edit the variables below, then run: bash deploy-production.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Configuration
# ---------------------------------------------------------------------------
RESOURCE_GROUP="seen-backend-prod-rg"
LOCATION="eastus2"

SUFFIX_FILE=".deploy-suffix-prod"
if [ -f "$SUFFIX_FILE" ]; then
  SUFFIX=$(cat "$SUFFIX_FILE")
else
  SUFFIX="$RANDOM"
  echo "$SUFFIX" > "$SUFFIX_FILE"
fi

VNET_NAME="seen-vnet"
GW_SUBNET="gw-subnet"
FUNC_SUBNET="func-subnet"
PE_SUBNET="pe-subnet"

STORAGE_ACCOUNT="seenprodsa${SUFFIX}"
FUNCTION_APP="seen-prod-func-${SUFFIX}"
APP_INSIGHTS="seen-prod-ai-${SUFFIX}"
KEY_VAULT="seen-prod-kv-${SUFFIX}"
ASP_NAME="seen-prod-asp-${SUFFIX}"

COSMOS_ACCOUNT="seen-prod-cosmos-${SUFFIX}"
COSMOS_DATABASE="seen-db"
COSMOS_CONTAINER="entries"

AOAI_ACCOUNT="seen-prod-aoai-${SUFFIX}"
AOAI_DEPLOYMENT="gpt-5-mini"
AOAI_MODEL="gpt-5-mini"
AOAI_MODEL_VERSION="2025-08-07"
AOAI_SKU="GlobalStandard"
AOAI_CAPACITY="10"

APP_GW_NAME="seen-prod-appgw-${SUFFIX}"
APP_GW_PUBLIC_IP="seen-prod-appgw-pip-${SUFFIX}"
WAF_POLICY_NAME="seen-prod-waf-${SUFFIX}"

NODE_VERSION="22"

echo "=== PRODUCTION deployment (VNet + App Gateway + private endpoints) ==="
echo "⚠️  Estimated cost: ~\$470/month"
echo
echo "Resource group:  $RESOURCE_GROUP"
echo "Function App:    $FUNCTION_APP"
echo "App Gateway:     $APP_GW_NAME"
echo "Cosmos DB:       $COSMOS_ACCOUNT"
echo "Azure OpenAI:    $AOAI_ACCOUNT"
echo
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Resource group
# ---------------------------------------------------------------------------
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# ---------------------------------------------------------------------------
# 3. VNet + subnets
# ---------------------------------------------------------------------------
az network vnet create \
  --name "$VNET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --address-prefix "10.0.0.0/16" \
  --output none

az network vnet subnet create \
  --vnet-name "$VNET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$GW_SUBNET" \
  --address-prefixes "10.0.1.0/24" \
  --output none

az network vnet subnet create \
  --vnet-name "$VNET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNC_SUBNET" \
  --address-prefixes "10.0.2.0/24" \
  --delegations "Microsoft.Web/serverFarms" \
  --output none

az network vnet subnet create \
  --vnet-name "$VNET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PE_SUBNET" \
  --address-prefixes "10.0.3.0/24" \
  --output none

# Disable private endpoint network policies on the PE subnet
az network vnet subnet update \
  --vnet-name "$VNET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PE_SUBNET" \
  --private-endpoint-network-policies Disabled \
  --output none

# ---------------------------------------------------------------------------
# 4. Storage account + private endpoint
# ---------------------------------------------------------------------------
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --output none

STORAGE_ID=$(az storage account show \
  --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query id -o tsv)

az network private-endpoint create \
  --name "${STORAGE_ACCOUNT}-pe" \
  --resource-group "$RESOURCE_GROUP" \
  --vnet-name "$VNET_NAME" \
  --subnet "$PE_SUBNET" \
  --private-connection-resource-id "$STORAGE_ID" \
  --group-id blob \
  --connection-name "${STORAGE_ACCOUNT}-pe-conn" \
  --output none

az network private-dns zone create \
  --resource-group "$RESOURCE_GROUP" \
  --name "privatelink.blob.core.windows.net" \
  --output none

az network private-dns link vnet create \
  --resource-group "$RESOURCE_GROUP" \
  --zone-name "privatelink.blob.core.windows.net" \
  --name "${VNET_NAME}-blob-link" \
  --virtual-network "$VNET_NAME" \
  --registration-enabled false \
  --output none

az network private-endpoint dns-zone-group create \
  --resource-group "$RESOURCE_GROUP" \
  --endpoint-name "${STORAGE_ACCOUNT}-pe" \
  --name "blob-dns-group" \
  --private-dns-zone "privatelink.blob.core.windows.net" \
  --zone-name "blob" \
  --output none

az storage account update \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --public-network-access Disabled \
  --output none

# ---------------------------------------------------------------------------
# 5. Application Insights
# ---------------------------------------------------------------------------
az monitor app-insights component create \
  --app "$APP_INSIGHTS" \
  --location "$LOCATION" \
  --resource-group "$RESOURCE_GROUP" \
  --application-type web \
  --output none

# ---------------------------------------------------------------------------
# 6. Function App — Elastic Premium EP1 + VNet Integration
# ---------------------------------------------------------------------------
az functionapp plan create \
  --name "$ASP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku EP1 \
  --is-linux true \
  --output none

az functionapp create \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-account "$STORAGE_ACCOUNT" \
  --plan "$ASP_NAME" \
  --runtime node \
  --runtime-version "$NODE_VERSION" \
  --functions-version 4 \
  --os-type Linux \
  --app-insights "$APP_INSIGHTS" \
  --output none

az functionapp vnet-integration add \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --vnet "$VNET_NAME" \
  --subnet "$FUNC_SUBNET" \
  --output none

# Route all outbound traffic through VNet
az functionapp config appsettings set \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --settings "WEBSITE_VNET_ROUTE_ALL=1" \
  --output none

# ---------------------------------------------------------------------------
# 7. Azure OpenAI resource + model deployment
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
# 8. Key Vault + private endpoint
# ---------------------------------------------------------------------------
az keyvault create \
  --name "$KEY_VAULT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --enable-rbac-authorization false \
  --output none

KV_ID=$(az keyvault show \
  --name "$KEY_VAULT" --resource-group "$RESOURCE_GROUP" \
  --query id -o tsv)

az network private-endpoint create \
  --name "${KEY_VAULT}-pe" \
  --resource-group "$RESOURCE_GROUP" \
  --vnet-name "$VNET_NAME" \
  --subnet "$PE_SUBNET" \
  --private-connection-resource-id "$KV_ID" \
  --group-id vault \
  --connection-name "${KEY_VAULT}-pe-conn" \
  --output none

az network private-dns zone create \
  --resource-group "$RESOURCE_GROUP" \
  --name "privatelink.vaultcore.azure.net" \
  --output none

az network private-dns link vnet create \
  --resource-group "$RESOURCE_GROUP" \
  --zone-name "privatelink.vaultcore.azure.net" \
  --name "${VNET_NAME}-kv-link" \
  --virtual-network "$VNET_NAME" \
  --registration-enabled false \
  --output none

az network private-endpoint dns-zone-group create \
  --resource-group "$RESOURCE_GROUP" \
  --endpoint-name "${KEY_VAULT}-pe" \
  --name "kv-dns-group" \
  --private-dns-zone "privatelink.vaultcore.azure.net" \
  --zone-name "vault" \
  --output none

az keyvault update \
  --name "$KEY_VAULT" \
  --resource-group "$RESOURCE_GROUP" \
  --default-action Deny \
  --bypass AzureServices \
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
# 9. Cosmos DB + private endpoint
# ---------------------------------------------------------------------------
az cosmosdb create \
  --name "$COSMOS_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --locations regionName="$LOCATION" failoverPriority=0 \
  --default-consistency-level Session \
  --enable-free-tier false \
  --public-network-access DISABLED \
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

COSMOS_ID=$(az cosmosdb show \
  --name "$COSMOS_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query id -o tsv)

az network private-endpoint create \
  --name "${COSMOS_ACCOUNT}-pe" \
  --resource-group "$RESOURCE_GROUP" \
  --vnet-name "$VNET_NAME" \
  --subnet "$PE_SUBNET" \
  --private-connection-resource-id "$COSMOS_ID" \
  --group-id Sql \
  --connection-name "${COSMOS_ACCOUNT}-pe-conn" \
  --output none

az network private-dns zone create \
  --resource-group "$RESOURCE_GROUP" \
  --name "privatelink.documents.azure.com" \
  --output none

az network private-dns link vnet create \
  --resource-group "$RESOURCE_GROUP" \
  --zone-name "privatelink.documents.azure.com" \
  --name "${VNET_NAME}-cosmos-link" \
  --virtual-network "$VNET_NAME" \
  --registration-enabled false \
  --output none

az network private-endpoint dns-zone-group create \
  --resource-group "$RESOURCE_GROUP" \
  --endpoint-name "${COSMOS_ACCOUNT}-pe" \
  --name "cosmos-dns-group" \
  --private-dns-zone "privatelink.documents.azure.com" \
  --zone-name "cosmos" \
  --output none

COSMOS_ENDPOINT=$(az cosmosdb show \
  --name "$COSMOS_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query documentEndpoint -o tsv)

COSMOS_KEY=$(az cosmosdb keys list \
  --name "$COSMOS_ACCOUNT" --resource-group "$RESOURCE_GROUP" \
  --query primaryMasterKey -o tsv)

az keyvault secret set \
  --vault-name "$KEY_VAULT" \
  --name "CosmosKey" \
  --value "$COSMOS_KEY" \
  --output none

COSMOS_SECRET_URI=$(az keyvault secret show \
  --vault-name "$KEY_VAULT" --name "CosmosKey" \
  --query "id" -o tsv)

# ---------------------------------------------------------------------------
# 10. Grant Function App managed identity access to Key Vault
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
# 11. Application Gateway with WAF v2
# ---------------------------------------------------------------------------
FUNC_HOSTNAME="${FUNCTION_APP}.azurewebsites.net"

az network public-ip create \
  --name "$APP_GW_PUBLIC_IP" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard \
  --allocation-method Static \
  --output none

az network waf-policy create \
  --name "$WAF_POLICY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

az network waf-policy managed-rule rule-set add \
  --policy-name "$WAF_POLICY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --type OWASP \
  --version 3.2 \
  --output none

az network application-gateway create \
  --name "$APP_GW_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku WAF_v2 \
  --capacity 1 \
  --vnet-name "$VNET_NAME" \
  --subnet "$GW_SUBNET" \
  --public-ip-address "$APP_GW_PUBLIC_IP" \
  --http-settings-port 443 \
  --http-settings-protocol Https \
  --frontend-port 80 \
  --waf-policy "$WAF_POLICY_NAME" \
  --servers "$FUNC_HOSTNAME" \
  --priority 100 \
  --output none

# Configure backend HTTP settings to pick hostname from backend
az network application-gateway http-settings update \
  --gateway-name "$APP_GW_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "appGatewayBackendHttpSettings" \
  --host-name-from-backend-pool true \
  --output none

# Health probe
az network application-gateway probe create \
  --gateway-name "$APP_GW_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "health-probe" \
  --protocol Https \
  --host-name-from-http-settings true \
  --path "/api/health" \
  --interval 30 \
  --timeout 30 \
  --threshold 3 \
  --output none

az network application-gateway http-settings update \
  --gateway-name "$APP_GW_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "appGatewayBackendHttpSettings" \
  --probe "health-probe" \
  --output none

# ---------------------------------------------------------------------------
# 12. Restrict Function App to only accept traffic from the App Gateway
# ---------------------------------------------------------------------------
GW_SUBNET_ID=$(az network vnet subnet show \
  --vnet-name "$VNET_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$GW_SUBNET" \
  --query id -o tsv)

az functionapp config access-restriction add \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --rule-name "AllowAppGateway" \
  --priority 100 \
  --subnet "$GW_SUBNET_ID" \
  --output none

az functionapp config access-restriction set \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --default-action Deny \
  --output none

# ---------------------------------------------------------------------------
# 13. App settings — secrets via Key Vault references
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
    "WEBSITE_VNET_ROUTE_ALL=1" \
  --output none

# ---------------------------------------------------------------------------
# 14. Build + deploy code
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
# 15. Final restart + print connection info
# ---------------------------------------------------------------------------
az functionapp restart --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP"
echo "Waiting 30s for the app to finish restarting..."
sleep 30

APP_GW_IP=$(az network public-ip show \
  --name "$APP_GW_PUBLIC_IP" --resource-group "$RESOURCE_GROUP" \
  --query ipAddress -o tsv)

FUNCTION_KEY=$(az functionapp keys list \
  --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" \
  --query "functionKeys.default" -o tsv)

echo
echo "=========================================================================="
echo "Deployed (PRODUCTION mode — VNet + App Gateway + private endpoints)."
echo
echo "App Gateway IP:  $APP_GW_IP"
echo "Function key:    $FUNCTION_KEY"
echo
echo "The Function App is NOT publicly accessible."
echo "All traffic must go through the App Gateway:"
echo "  curl \"http://${APP_GW_IP}/api/health\""
echo "  curl \"http://${APP_GW_IP}/api/profiles?code=${FUNCTION_KEY}\""
echo
echo "⚠️  To add HTTPS, attach an SSL certificate to the App Gateway."
echo "⚠️  This setup costs ~\$470/month. Run teardown.sh to delete everything."
echo "=========================================================================="
