# Authentication

The platform uses API keys for authentication. All requests must include your API key.

## Getting an API Key

1. Log in to the dashboard at https://dashboard.example.com
2. Navigate to **Settings → API Keys**
3. Click **Create new key**
4. Copy the key — it won't be shown again

## Using Your Key

Pass the key via the `Authorization` header:

```http
Authorization: Bearer YOUR_API_KEY
```

Or through the SDK:

```typescript
const client = new Client({ apiKey: "YOUR_API_KEY" });
```

## Key Rotation

Rotate keys regularly. Old keys remain valid for 24 hours after rotation to allow a smooth transition.

## Scopes

| Scope    | Description                  |
| -------- | ---------------------------- |
| `read`   | Read-only access to all data |
| `write`  | Create and update resources  |
| `admin`  | Full administrative access   |
