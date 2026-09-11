# Piano di sviluppo

Questo piano realizza il risultato descritto in [PROGETTO.md](PROGETTO.md) per fasi indipendenti e verificabili.

Ogni fase termina con un punto di revisione. Non si passa alla fase successiva finché i criteri di completamento non sono soddisfatti e il comportamento osservato non è stato confrontato con quello atteso.

## Regola dei commit

Al termine di ogni fase completata devono essere eseguiti, nello stesso ordine:

1. verifica automatica e prova manuale del checkpoint;
2. aggiornamento dello stato della fase in questo documento;
3. commit Git separato e descrittivo, contenente soltanto il lavoro della fase;
4. controllo dello stato della workspace prima di iniziare la fase successiva.

Se il checkpoint fallisce, non si crea il commit della fase: si corregge il lavoro oppure si registra esplicitamente il blocco e la causa.

## Metodo di lavoro

Per ogni fase devono essere prodotti:

- codice funzionante e circoscritto;
- test automatici proporzionati alla funzionalità;
- una prova manuale ripetibile;
- log leggibili degli errori;
- una breve nota sulle decisioni prese e sui problemi rimasti.

Durante i checkpoint si può scegliere di proseguire, correggere la fase corrente, ridurre la complessità, cambiare una decisione architetturale o rimandare una funzione non essenziale.

L'AI viene introdotta gradualmente: prima si dimostra che il mondo funziona senza AI, poi si permette ai modelli di proporre interpretazioni e aggiornamenti controllati.

## Fase 0 — Definizione operativa e ambiente

Stato: **completata**.

### Obiettivo

Preparare un progetto riproducibile e fissare il perimetro della prima campagna dimostrativa.

### Attività

- scegliere stack frontend, backend e database;
- definire modalità di avvio locale;
- configurare lint, test e formattazione;
- definire il formato degli ID;
- definire la campagna dimostrativa iniziale;
- stabilire la configurazione dei provider AI esclusivamente in Docker;
- creare il `docker-compose.yml` con reti interne e rete proxy esterna;
- aggiungere il servizio Ollama alla rete interna, con volume persistente per i modelli;
- aggiungere una rete Docker separata per l'uscita Internet necessaria a Ollama;
- configurare il frontend come unico ingresso pubblico e gateway interno per `/api`;
- documentare il contratto del proxy senza gestirne configurazione, TLS o domini;
- definire volumi persistenti e profili con e senza GPU;
- creare il registro delle decisioni tecniche.

### Verifica e checkpoint

- l'applicazione si avvia da una workspace pulita;
- il database viene creato e migrato;
- i container comunicano usando soltanto le reti previste;
- il database non è pubblicato verso il proxy o l'host in produzione locale;
- Ollama risponde al backend tramite `ollama:11434` e non tramite `localhost`;
- Ollama raggiunge il registry soltanto tramite la rete `ai-egress`;
- i modelli Ollama persistono dopo il riavvio dei container;
- il frontend è raggiungibile dalla rete proxy condivisa;
- il frontend usa `/api` e non indirizzi `localhost` o DNS interni nel browser;
- un comando esegue i test;
- una campagna vuota può essere creata e ricaricata;
- i comandi di sviluppo sono documentati.

Controllare che il progetto sia abbastanza piccolo da poter essere eseguito e analizzato senza introdurre subito chat, immagini o automazioni complesse.

### Criterio di uscita

Ambiente avviabile in Docker, reti e volumi documentati, contratto con il proxy definito e prima campagna definita.

## Fase 1 — Modello dati e persistenza

Stato: **completata**.

### Obiettivo

Creare la fonte autorevole dello stato del mondo.

### Attività

Implementare schema e repository per campagne, protagonisti, personaggi, luoghi, collegamenti, oggetti, inventario, equipaggiamento, relazioni, fazioni, memorie, missioni, eventi, salvataggi e versioni.

Ogni modifica importante deve essere registrata come evento e applicata tramite transazione.

### Verifica e checkpoint

- CRUD e archiviazione delle entità;
- migrazione da database vuoto;
- rollback di una transazione fallita;
- salvataggio e ricaricamento senza perdita di dati;
- rifiuto di riferimenti a entità inesistenti;
- mantenimento dell'ordine degli eventi.

Controllare se il modello dati rappresenta una scena senza usare il testo narrativo come fonte di verità. Correggere ora nomi, relazioni o cardinalità ambigue.

### Criterio di uscita

Una campagna può essere persistita e ricostruita interamente dal database.

## Fase 2 — Motore deterministico dello stato

Stato: **completata**.

### Obiettivo

Applicare azioni e conseguenze senza alcun modello AI.

### Attività

Implementare comandi validati per muovere un personaggio, osservare un luogo, parlare, prendere e usare oggetti, equipaggiare, attraversare collegamenti, modificare relazioni, avanzare il tempo e creare conseguenze.

Ogni comando deve avere precondizioni, effetti e messaggi di errore.

### Verifica e checkpoint

- un oggetto non può essere usato se non è posseduto;
- una porta chiusa o inaccessibile non può essere attraversata;
- un personaggio non può apparire in due luoghi incompatibili;
- le azioni fallite non modificano parzialmente lo stato;
- il registro degli eventi permette di ricostruire lo stato.

Giocare una micro-scena interamente tramite comandi tecnici e verificare ogni conseguenza nel database. Se questa fase non è solida, l'AI non viene ancora collegata.

### Criterio di uscita

Una micro-avventura deterministica è giocabile dall'inizio alla fine.

## Fase 3 — Luoghi, percezione e conoscenza

Stato: **completata**.

### Obiettivo

Gestire luoghi semplici e complessi e impedire che i soggetti conoscano informazioni non accessibili.

### Attività

- implementare il grafo dei luoghi;
- aggiungere porte, scale, corridoi e passaggi condizionati;
- calcolare posizione e raggiungibilità;
- gestire visibilità, rumore e illuminazione;
- creare il filtro delle informazioni percepibili;
- distinguere fatti, supposizioni, voci e segreti;
- aggiornare la mappa scoperta dal protagonista.

### Verifica e checkpoint

- edificio con almeno due piani e percorsi alternativi;
- passaggio nascosto non visibile prima della scoperta;
- dialogo percepito solo da chi è abbastanza vicino;
- evento isolato non conosciuto dai personaggi lontani;
- segreto visibile al narratore ma non ai personaggi.

Ispezionare manualmente la mappa e le viste di conoscenza di almeno tre personaggi. Correggere qualsiasi fuga di informazioni prima di introdurre la generazione linguistica.

### Criterio di uscita

Posizione, accessibilità e conoscenza sono calcolate dal software e non dalla descrizione AI.

## Fase 4 — Contratti JSON e simulatore AI

Stato: **completata**.

### Obiettivo

Definire un percorso sicuro fra modelli e software senza dipendere inizialmente da un modello reale.

### Attività

- definire JSON Schema versionati;
- creare schemi per intenzioni, azioni, eventi, patch e riassunti;
- implementare validatore e normalizzatore;
- controllare ID, tipi, enum e precondizioni;
- usare patch limitate invece di sostituzioni complete;
- creare risposte AI simulate per i test;
- implementare retry singolo, fallback e rollback.

### Verifica e checkpoint

- JSON valido accettato;
- JSON incompleto o con ID falsi rifiutato;
- operazione non consentita rifiutata;
- patch parziale applicata senza alterare campi estranei;
- risposta non valida recuperata senza corrompere lo stato;
- limite massimo di operazioni per turno rispettato.

Provare intenzionalmente output errati, allucinati e contraddittori. Il sistema deve fallire in modo controllato e spiegabile.

### Criterio di uscita

Un modello simulato può proporre modifiche, ma soltanto il motore validato può applicarle.

## Fase 5 — Primo turno con modello locale

Stato: **completata**.

### Obiettivo

Collegare un modello locale per interpretare l'input dell'utente e completare il primo ciclo reale.

### Attività

- implementare il router dei provider;
- collegare il modello interprete JSON;
- trasformare input come “apro la porta” in un'intenzione strutturata;
- passare l'intenzione al motore deterministico;
- restituire all'utente l'esito dell'azione;
- registrare prompt, risposta, durata e validazione;
- aggiungere timeout e comportamento offline.

### Verifica e checkpoint

- azioni esplicite interpretate correttamente;
- azioni impossibili rifiutate dal motore;
- ambiguità richiesta all'utente o marcata come non risolta;
- modello non disponibile gestito senza bloccare la campagna;
- nessuna modifica applicata da testo libero non validato.

Misurare gli errori di interpretazione e correggere prompt, schema o interfaccia prima di aumentare la libertà linguistica.

### Criterio di uscita

L'utente può impartire azioni in linguaggio naturale, ma il risultato è controllato dal motore delle regole.

## Fase 6 — Narratore e risposta naturale

Stato: **completata**.

### Obiettivo

Generare una narrazione coerente basata sullo stato già aggiornato.

### Attività

- creare il modello narrativo;
- costruire il contesto minimo della scena;
- separare testo visibile e segreti del narratore;
- generare descrizioni, dialoghi e conseguenze;
- mantenere una risposta utile se un arricchimento opzionale fallisce;
- introdurre il canale privato con il narratore.

### Verifica e checkpoint

- il narratore descrive l'esito reale dell'azione;
- non attribuisce al protagonista azioni non richieste;
- non rivela informazioni non autorizzate;
- il messaggio privato non entra nella memoria dei personaggi;
- un errore del modello mantiene lo stato già salvato;
- la risposta è riconducibile agli eventi registrati.

Confrontare stato tecnico e testo narrativo turno per turno. Annotare allucinazioni, omissioni e tono incoerente e correggere prompt o filtri.

### Criterio di uscita

È disponibile una prima esperienza narrativa completa in prima persona.

## Fase 7 — Personaggi autonomi e psicologia

Stato: **completata**.

### Obiettivo

Introdurre personaggi non giocanti coerenti, con decisioni limitate dalla loro situazione.

### Attività

- implementare obiettivi, paure, principi e conflitti;
- aggiungere tratti graduati come fiducia, stress e morale;
- creare il modello decisionale del personaggio;
- applicare il filtro di percezione individuale;
- aggiornare relazioni e psicologia con motivazioni registrate;
- impedire duplicati nella creazione automatica delle entità.

### Verifica e checkpoint

- un personaggio agisce in base a obiettivi e conoscenze proprie;
- due personaggi reagiscono diversamente allo stesso evento;
- un personaggio non usa informazioni segrete altrui;
- ogni cambiamento psicologico ha eventi motivanti;
- un personaggio lontano non reagisce istantaneamente senza motivo.

Seguire una scena con tre personaggi e controllare decisioni, conoscenze, relazioni e motivazioni. Ridurre l'autonomia se genera azioni non verificabili.

### Criterio di uscita

I personaggi reagiscono autonomamente ma dentro limiti osservabili e testabili.

## Fase 8 — Memoria e contesto a livelli

Stato: **completata**.

### Obiettivo

Evitare che la crescita della storia faccia perdere coerenza ai modelli locali.

### Attività

- implementare memoria CRUD individuale;
- creare ranking per rilevanza, luogo, soggetti, recenza e importanza;
- distinguere fatti, opinioni, voci, sospetti e segreti;
- creare riassunti della scena, dell'arco e della campagna;
- mantenere riassunti separati per personaggio;
- inserire soglie di token configurabili;
- conservare gli eventi originali come fonte primaria;
- mostrare all'utente le memorie usate per una decisione.

### Verifica e checkpoint

- l'utente crea, modifica, archivia e ripristina un record;
- una memoria importante resta selezionabile dopo molti turni;
- una memoria irrilevante viene esclusa dal contesto;
- i riassunti non trasformano supposizioni in fatti;
- il contesto resta entro il limite configurato;
- la storia continua correttamente dopo il riassunto.

Eseguire una campagna lunga e confrontare eventi originali, riassunti e memoria selezionata. Correggere perdita di informazioni o contaminazione fra personaggi.

### Criterio di uscita

La campagna può crescere senza inviare tutta la cronologia ai modelli e senza perdere i fatti importanti.

## Fase 9 — TurnDirector e orchestrazione completa

Stato: **completata**.

### Obiettivo

Unificare i componenti in un ciclo robusto, osservabile e interrompibile.

### Attività

- implementare `TurnDirector`;
- definire gli stati del turno: ricevuto, interpretato, validato, simulato, applicato, narrato e fallito;
- imporre timeout, budget e massimo numero di tentativi;
- gestire fallback fra modelli;
- impedire cicli infiniti fra narratore e personaggi;
- applicare gli aggiornamenti in transazione;
- registrare la trace completa del turno;
- implementare rollback e ripresa dopo errore.

### Verifica e checkpoint

- modello interprete lento o assente;
- modello narrativo non disponibile;
- output JSON invalido;
- aggiornamento valido ma narrazione fallita;
- errore durante la transazione;
- due richieste simultanee sulla stessa campagna;
- ripresa dal punto corretto senza duplicare eventi.

Osservare i log di dieci turni completi. Ogni turno deve essere spiegabile dall'input fino agli eventi e al testo finale.

### Criterio di uscita

Il ciclo completo è robusto anche con modelli piccoli, lenti o temporaneamente indisponibili.

## Fase 10 — Interfaccia di gioco e strumenti di debug

### Obiettivo

Rendere il sistema giocabile e correggibile senza modificare direttamente il database.

### Attività

- costruire chat e risposta in prima persona;
- aggiungere pannello narratore privato;
- creare schede di protagonista e personaggi;
- aggiungere inventario ed equipaggiamento;
- visualizzare mappa e luogo corrente;
- aggiungere timeline e fili narrativi;
- creare editor CRUD delle memorie;
- mostrare eventi, cause, prompt, patch e rifiuti;
- aggiungere versioni, backup, ripristino e undo sicuro.

### Verifica e checkpoint

- flusso completo da creazione campagna a primo turno;
- uso da viewport desktop e mobile;
- modifica manuale di un personaggio durante la campagna;
- correzione di una memoria errata;
- ripristino di una versione precedente;
- visualizzazione comprensibile di un errore AI.

Usare l'app come utente per una sessione completa. Annotare dove l'interfaccia nasconde lo stato o rende difficile correggere una decisione.

### Criterio di uscita

La campagna è giocabile e amministrabile dall'interfaccia, senza strumenti tecnici esterni.

## Fase 11 — Campagna dimostrativa e validazione finale

### Obiettivo

Dimostrare che il sistema finale è funzionale, coerente e riproducibile.

### Scenario minimo

La campagna dimostrativa deve contenere:

- un protagonista;
- almeno tre personaggi non giocanti;
- un edificio con stanze e percorsi alternativi;
- una porta chiusa e un passaggio nascosto;
- almeno un oggetto trasferibile;
- una relazione che cambia;
- un segreto del narratore;
- una missione con conseguenza ritardata;
- una memoria modificata manualmente;
- almeno un riassunto automatico.

### Verifica e checkpoint finale

- test automatici completi;
- build riproducibile;
- campagna dimostrativa dall'inizio alla fine;
- salvataggio e ripresa su un nuovo avvio;
- verifica dei contesti separati;
- verifica di inventario, luoghi e relazioni;
- test con modello locale configurato;
- test con modello non disponibile;
- controllo dei log e dei tempi di risposta;
- backup esportato e ripristinato.

Decidere quali funzioni sono affidabili, quali sono sperimentali e quali devono essere disattivate. Nessuna funzione viene dichiarata completata soltanto perché produce testo plausibile.

### Criterio di uscita

Esiste una versione dimostrabile, debuggabile e utilizzabile, con limiti noti e una base solida per le estensioni future.

## Ordine delle priorità

Se sarà necessario ridurre lo scope, mantenere in quest'ordine:

1. stato autorevole e persistenza;
2. eventi, regole e validazione;
3. luoghi, posizioni e conoscenza;
4. pipeline JSON e primo modello locale;
5. narratore;
6. personaggi autonomi;
7. memoria e riassunti;
8. interfaccia avanzata;
9. immagini, voce e altri arricchimenti.

La qualità della coerenza viene prima della quantità di funzioni narrative.
