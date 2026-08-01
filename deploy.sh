#!/usr/bin/env bash
# Seen backend — Azure deployment script.
# Provisions: resource group, storage account, Application Insights,
# a Linux Consumption Function App, an Azure OpenAI resource + model
# deployment, and a Key Vault holding the Azure OpenAI key (accessed by
# the Function App's managed identity via a Key Vault reference).
#
# Edit the variables below, then run: bash deploy.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Configuration — edit these before running
# ---------------------------------------------------------------------------
RESOURCE_GROUP="seen-backend-rg"
LOCATION="eastus2"                              # must support both Functions + Azure OpenAI

# Suffix is generated once and cached in .deploy-suffix so re-running this
# script after a failure RESUMES against the same resources instead of
# abandoning them and creating a fresh, duplicate set under a new name.
# Delete .deploy-suffix yourself if you want a genuinely fresh deployment.
SUFFIX_FILE=".deploy-suffix"
if [ -f "$SUFFIX_FILE" ]; then
  SUFFIX=$(cat "$SUFFIX_FILE")
else
  SUFFIX="$RANDOM"
  echo "$SUFFIX" > "$SUFFIX_FILE"
fi

STORAGE_ACCOUNT="seenbackendsa${SUFFIX}"        # <=24 chars, lowercase letters/numbers only
FUNCTION_APP="seen-backend-func-${SUFFIX}"
APP_INSIGHTS="seen-backend-ai-${SUFFIX}"
KEY_VAULT="seen-backend-kv-${SUFFIX}"           # <=24 chars

AOAI_ACCOUNT="seen-backend-aoai-${SUFFIX}"
AOAI_DEPLOYMENT="gpt-5-mini"
AOAI_MODEL="gpt-5-mini"
AOAI_MODEL_VERSION="2025-08-07"
AOAI_SKU="GlobalStandard"                       # gpt-5-mini and newer models are GlobalStandard-only (no plain "Standard" SKU)
AOAI_CAPACITY="10"

# Before relying on the values above, they can drift as Microsoft deprecates
# older models/SKUs. Re-check what's actually available for your resource with:
#   az cognitiveservices account list-models --name <AOAI_ACCOUNT> --resource-group <RESOURCE_GROUP> \
#     --query "[?contains(name, 'mini') && lifecycleStatus=='GenerallyAvailable'].{name:name, version:version, skus:skus[].name}"

NODE_VERSION="22"                               # Node 20 reached end-of-life 2026-04-30. Node 24 is listed by
                                                 # `az functionapp list-runtimes --os linux` but its Functions language
                                                 # worker was unreliable in testing (host stuck ServiceUnavailable);
                                                 # Node 22 (Active LTS) worked. Re-check before assuming this is still current.

echo "Resource group:  $RESOURCE_GROUP"
echo "Function App:    $FUNCTION_APP"
echo "Storage account: $STORAGE_ACCOUNT"
echo "Key Vault:       $KEY_VAULT"
echo "Azure OpenAI:    $AOAI_ACCOUNT (deployment: $AOAI_DEPLOYMENT)"
echo

# ---------------------------------------------------------------------------
# 2. Resource group
# ---------------------------------------------------------------------------
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# ---------------------------------------------------------------------------
# 3. Storage account — Functions runtime storage AND the DailyEntry blob store
# ---------------------------------------------------------------------------
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --output none

# ---------------------------------------------------------------------------
# 4. Application Insights (function logs/metrics)
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
# 6. Azure OpenAI resource + a chat model deployment
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
# 7. Key Vault — store the Azure OpenAI key as a secret (access-policy model,
#    not RBAC, so `set-policy` below works without extra role-assignment delay)
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

SECRET_URI=$(az keyvault secret show \
  --vault-name "$KEY_VAULT" --name "AzureOpenAIApiKey" \
  --query "id" -o tsv)

# ---------------------------------------------------------------------------
# 8. Grant the Function App's managed identity read access to the secret
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
# 9. App settings — the API key is a Key Vault reference, resolved by the
#    platform at runtime using the Function App's managed identity. The key
#    itself never appears in app settings, deployment logs, or this script's
#    output beyond the one-time secret upload above.
# ---------------------------------------------------------------------------
az functionapp config appsettings set \
  --name "$FUNCTION_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    "AZURE_OPENAI_ENDPOINT=$AOAI_ENDPOINT" \
    "AZURE_OPENAI_API_VERSION=2024-10-21" \
    "AZURE_OPENAI_DEPLOYMENT=$AOAI_DEPLOYMENT" \
    "ENTRIES_CONTAINER=seen-data" \
    "ENTRIES_BLOB_NAME=entries.json" \
    "AZURE_OPENAI_API_KEY=@Microsoft.KeyVault(SecretUri=$SECRET_URI)" \
    "SCM_DO_BUILD_DURING_DEPLOYMENT=false" \
  --output none

# ---------------------------------------------------------------------------
# 10. Build locally, then prune to production deps only, then zip-deploy.
#     Order matters: the TypeScript compiler is a devDependency, so it must
#     still be installed when `npm run build` runs. Stripping dev deps has to
#     happen AFTER the build, not before.
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

# Reinstall dev dependencies locally so `npm run build`/`npm run watch` keep working after this script
npm install

# ---------------------------------------------------------------------------
# 11. Restart so the Key Vault reference resolves, then fetch a function key
# ---------------------------------------------------------------------------
az functionapp restart --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP"
echo "Waiting 30s for the app to finish restarting..."
sleep 30

FUNCTION_KEY=$(az functionapp keys list \
  --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" \
  --query "functionKeys.default" -o tsv)

echo
echo "=========================================================================="
echo "Deployed."
echo "Base URL:     https://${FUNCTION_APP}.azurewebsites.net/api"
echo "Function key: ${FUNCTION_KEY}"
echo
echo "Try it:"
echo "  curl \"https://${FUNCTION_APP}.azurewebsites.net/api/health\""
echo "  curl \"https://${FUNCTION_APP}.azurewebsites.net/api/profiles?code=${FUNCTION_KEY}\""
echo "=========================================================================="
