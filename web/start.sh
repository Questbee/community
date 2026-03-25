#!/bin/sh
echo ""
echo "  ┌──────────────────────────────────────────────────┐"
echo "  │  Questbee is ready                               │"
echo "  │                                                  │"
echo "  │  Dashboard  →  http://localhost:3000             │"
echo "  │  API docs   →  http://localhost:8000/docs        │"
echo "  └──────────────────────────────────────────────────┘"
echo ""
exec node server.js
