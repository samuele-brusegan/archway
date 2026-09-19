# Archway

Motore narrativo locale con stato autorevole SQLite, modelli Ollama in Docker e interfaccia web responsive.

## Avvio

1. Copiare `.env.example` in `.env` e impostare i tre modelli Ollama.
2. Assicurarsi che esista la rete Docker esterna indicata da `PROXY_NETWORK`.
3. Avviare con `docker compose up -d --build`.
4. Scaricare i modelli con `docker compose exec ollama ollama pull <modello>`.

Per lo sviluppo diretto usare `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`. Per abilitare una GPU supportata da Docker aggiungere `-f docker-compose.gpu.yml`.

Il proxy esterno deve pubblicare esclusivamente `frontend`; TLS, dominio e autenticazione restano fuori dal progetto.

## Verifica

```sh
docker build -t archway-backend-test backend
docker run --rm --entrypoint npm archway-backend-test test
docker compose config --quiet
```

I test usano un database temporaneo e un provider Ollama irraggiungibile per verificare anche i fallback.

## Dati e backup

SQLite e i modelli risiedono nei volumi `archway-backend-data` e `archway-ollama-data`. Dall'interfaccia è possibile creare versioni della campagna ed esportare un backup JSON leggibile e reimportabile.
