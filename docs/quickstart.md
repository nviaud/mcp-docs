---
title: "Quickstart Guide"
description: "Get up and running with the platform in minutes"
tags: [quickstart, getting-started, sdk]
---

# Quickstart Guide

Welcome to the platform! This guide will get you up and running in minutes.

## Prerequisites

- Node.js 18 or later
- An API key (get one from the dashboard)

## Installation

```bash
npm install @myplatform/sdk
```

## Your First Request

```typescript
import { Client } from "@myplatform/sdk";

const client = new Client({ apiKey: process.env.API_KEY });

const result = await client.doSomething({ input: "hello" });
console.log(result);
```

## Next Steps

- Read the [Authentication](./authentication.md) guide
- Explore the [API Reference](./api-reference.md)
