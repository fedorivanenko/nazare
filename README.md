# Nazare

Cloud-first v0 reboot.

## Repository layout

```txt
apps/
  registry-api/          Vercel-hosted package registry API

packages/
  cli-client/            `nazare` package manager / publisher / installer
  cli-dev/               `nazare-dev` local component dev + Shopify CLI glue
  compiler/              Nazare Liquid import/render compiler
  core/                  schemas, validators, package ID parsing, integrity helpers

examples/
  components/            demo component package sources
  themes/                demo Shopify themes
```
