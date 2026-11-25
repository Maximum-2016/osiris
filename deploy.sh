#!/bin/bash
# This fork is hosted as a Next.js app on Vercel.
# The upstream script committed every file and then SSHed to a private
# server as root. That target is gone. Do not restore it.
echo "OSIRIS deploys from Git on Vercel."
echo "Framework: Next.js. Root directory: ./"
echo "Install command: npm ci"
echo "Build command: npm run build"
echo "No environment variables are required. Optional keys are listed in .env.example."
exit 0
