# Progetto: Motore narrativo interattivo locale

## 1. Visione

L'applicazione è un ambiente narrativo interattivo in prima persona, alimentato da modelli di intelligenza artificiale eseguiti localmente.

L'utente vive una storia attraverso un personaggio principale. Il narratore descrive il mondo, interpreta le conseguenze delle azioni e coordina i personaggi non giocanti. Ogni personaggio possiede una personalità, una memoria, obiettivi, relazioni, conoscenze e uno stato autonomo. I luoghi sono entità esplorabili e collegate fra loro, da una semplice strada a un edificio composto da stanze e passaggi complessi.

Il software deve mantenere la coerenza del mondo. L'intelligenza artificiale produce interpretazioni, decisioni, dialoghi e testo narrativo, ma non rappresenta da sola la fonte ufficiale dello stato della storia.

Questo progetto è indipendente da AI-GDR. Ne raccoglie l'idea generale del gioco narrativo locale, ma nasce con un'architettura nuova, delimitata e verificabile.

## 2. Risultato finale

L'utente apre o crea una campagna, definisce il protagonista e l'ambientazione, quindi interagisce liberamente con il mondo tramite testo.

Ad ogni turno l'applicazione:

1. interpreta l'intento dell'utente;
2. verifica posizione, conoscenze, inventario, condizioni e regole;
3. applica gli aggiornamenti autorizzati allo stato del mondo;
4. determina quali personaggi possono percepire o conoscere l'evento;
5. calcola le reazioni dei personaggi coinvolti;
6. aggiorna memorie, relazioni, obiettivi e condizioni;
7. restituisce una risposta narrativa coerente;
8. registra l'evento nella cronologia della campagna.

La storia deve poter essere salvata, ripresa, ispezionata, modificata e riprodotta senza dipendere dalla memoria interna del modello AI.

## 3. Principi fondamentali

### Stato autorevole

Il database della campagna è la fonte di verità. Posizione, inventario, oggetti, porte, relazioni, condizioni e conoscenze vengono modificati tramite operazioni strutturate e validate.

### Separazione dei punti di vista

L'applicazione distingue sempre fra:

- informazioni note all'utente;
- informazioni note al protagonista;
- informazioni note a ciascun personaggio;
- verità segrete del narratore;
- informazioni ipotizzate, false o non confermate.

### AI controllata

Il modello locale non può modificare liberamente il database. Propone azioni strutturate; il motore le valida, le applica o le rifiuta spiegandone il motivo.

La narrazione strettamente verificata è la modalità predefinita: il testo visibile viene composto soltanto da fatti già confermati dallo stato e dagli eventi. La narrazione generativa libera è opzionale, sperimentale e non può sostituire il controllo del motore.

### Primo rendering rapido

La risposta narrativa principale non deve attendere dati opzionali come immagini, arricchimenti estetici o simulazioni non necessarie. Gli elementi secondari possono arrivare successivamente.

### Trasparenza

L'utente deve poter vedere perché un personaggio ha agito in un certo modo, quali memorie sono state usate e quali eventi hanno prodotto una conseguenza.

## 4. Funzionalità principali

### 4.1 Campagne

Ogni campagna contiene:

- titolo, genere, tono e premessa;
- regole e livello di realismo;
- narratore configurato;
- protagonista e personaggi;
- luoghi e oggetti;
- eventi e cronologia;
- missioni e fili narrativi;
- stato temporale e ambientale;
- salvataggi e versioni.

L'utente può creare una campagna da zero, usare un modello iniziale o importare/esportare una campagna completa.

### 4.2 Protagonista

Il protagonista dispone di:

- identità e biografia;
- descrizione fisica;
- descrizione psicologica;
- valori e tratti graduati;
- obiettivi, paure e conflitti;
- stato fisico e mentale;
- abiti, armatura ed equipaggiamento;
- inventario;
- posizione attuale;
- relazioni;
- memoria personale;
- conoscenze e segreti.

L'utente può modificare manualmente ogni componente, con cronologia e possibilità di bloccare gli aggiornamenti automatici su singoli campi.

### 4.3 Personaggi non giocanti

Ogni personaggio è un'entità autonoma. Il sistema può crearne di nuovi quando la storia lo richiede, ma deve evitare duplicati e riconoscere personaggi già esistenti.

Ogni personaggio possiede:

- identità, ruolo e appartenenze;
- descrizione fisica;
- abiti, armatura ed equipaggiamento;
- inventario;
- descrizione psicologica;
- tratti graduati: paura, fiducia, rabbia, stress, morale, curiosità e lealtà;
- desideri, obiettivi, limiti e principi;
- stato fisico e mentale;
- relazioni verso altri soggetti;
- posizione e attività corrente;
- memoria individuale;
- conoscenze, supposizioni e informazioni segrete.

La psicologia può evolvere automaticamente in seguito a traumi, scoperte, tradimenti, successi e ripetute esperienze. Ogni modifica deve essere motivata da uno o più eventi.

### 4.4 Memoria individuale CRUD

La memoria di ogni personaggio è composta da record indipendenti modificabili dall'utente.

Ogni record include:

- contenuto;
- tipo: fatto, opinione, voce, sospetto, ricordo, obiettivo o segreto;
- soggetti coinvolti;
- luogo e momento;
- fonte dell'informazione;
- attendibilità;
- importanza;
- ultima conferma;
- stato: attivo, superato, contraddetto o archiviato;
- origine: utente, narratore, evento o personaggio.

Il sistema può creare e aggiornare record automaticamente, ma non deve cancellare silenziosamente una memoria. Le modifiche sono versionate e consultabili.

Il contesto inviato al modello è limitato automaticamente in base a:

- limite di token configurato;
- rilevanza rispetto alla scena;
- posizione e collegamenti del luogo;
- soggetti coinvolti;
- obiettivi attivi;
- recenza e importanza;
- conoscenze realmente accessibili al personaggio.

### 4.5 Narratore

Il narratore:

- descrive ambienti, eventi e conseguenze;
- interpreta personaggi e fenomeni non controllati dall'utente;
- mantiene il tono della campagna;
- introduce eventi coerenti con gli obiettivi narrativi;
- gestisce misteri, informazioni segrete e fili narrativi;
- decide quando una scena è conclusa o richiede una conseguenza;
- non forza le azioni del protagonista senza autorizzazione.

È presente un canale privato di metagioco per comunicare direttamente con il narratore. I messaggi inviati in questo canale non vengono percepiti dal protagonista né dagli altri personaggi, salvo esplicita decisione dell'utente.

Il narratore può funzionare in modalità libera, rigorosa, investigativa, horror, orientata all'azione o emergente.

### 4.6 Luoghi e mappe

I luoghi sono modellati come un grafo semantico.

Un luogo può contenere:

- nodi: regioni, città, edifici, piani, stanze, strade o piazze;
- collegamenti: porte, scale, ascensori, corridoi, passaggi nascosti o uscite;
- proprietà: visibilità, rumore, illuminazione, accessibilità e sicurezza;
- condizioni: chiuso, sorvegliato, allagato, distrutto o occupato;
- oggetti e personaggi presenti;
- descrizione narrativa e caratteristiche sensoriali.

Il grafo non deve essere necessariamente una mesh geometrica. Deve rappresentare i percorsi effettivamente possibili e le condizioni che li regolano.

Il sistema gestisce esplorazione, inseguimenti, distanza, visibilità, rumore, accessi condizionati e scoperta progressiva della mappa.

### 4.7 Tempo, ambiente ed eventi

La campagna dispone di un tempo simulato con data, ora, durata delle azioni e avanzamento degli eventi.

Sono gestiti anche:

- meteo e illuminazione;
- rumori e segnali ambientali;
- eventi programmati;
- attività autonome dei personaggi;
- oggetti che cambiano stato;
- conseguenze ritardate;
- eventi attivi, conclusi, falliti o annullati.

Ogni cambiamento produce un evento registrato. Il registro degli eventi è la base per cronologia, undo, replay e diagnosi delle contraddizioni.

### 4.8 Relazioni e fazioni

Le relazioni sono direzionali e possono essere diverse fra due personaggi: fiducia, paura, rispetto, odio, debito, amore, rivalità o sospetto.

Le fazioni includono gerarchie, alleanze, conflitti, risorse, reputazione e obiettivi. Le relazioni e le fazioni possono modificarsi in seguito agli eventi, ma ogni cambiamento deve avere una causa registrata.

### 4.9 Inventario ed equipaggiamento

Ogni oggetto è un'entità con identità propria quando necessario. Il sistema distingue fra:

- possesso;
- posizione fisica;
- equipaggiamento indossato;
- oggetto consumabile;
- oggetto nascosto;
- oggetto rotto, perso, rubato o distrutto;
- proprietà visibili e proprietà segrete.

Un personaggio non può usare un oggetto che non possiede, non può conoscere automaticamente un oggetto nascosto e non può trasportare quantità incompatibili con le regole della campagna.

## 5. Architettura logica

Il sistema è composto da moduli indipendenti:

1. **Interfaccia utente**: chat, schede, mappa, cronologia e strumenti di amministrazione.
2. **Orchestratore narrativo**: coordina ogni turno e decide quali servizi invocare.
3. **Motore dello stato**: applica operazioni validate a campagna, personaggi, luoghi e oggetti.
4. **Motore di percezione e conoscenza**: calcola ciò che ogni soggetto può sapere.
5. **Gestore della memoria**: seleziona, crea, aggiorna, archivia e compatta i record.
6. **Motore dei luoghi**: gestisce grafo, accessi, visibilità e percorsi.
7. **Motore degli eventi**: registra conseguenze, pianifica attività e supporta replay.
8. **Router AI locale**: assegna modelli e compiti diversi a narratore, personaggi, estrazione dati e decisioni.
9. **Persistenza**: database locale, migrazioni, backup ed esportazione.

Il database consigliato è SQLite. Le operazioni importanti devono essere atomiche e transazionali.

## 6. Distribuzione Docker e rete dei container

L'ambiente di riferimento è Docker Compose. Il proxy inverso è esterno al progetto e non viene installato, configurato o gestito dall'applicazione.

### Topologia

```text
Client
  │
  ▼
Proxy esterno e non gestito dal progetto
  │  pubblica il frontend
  ▼
frontend  ───── rete proxy condivisa
  │  inoltra internamente /api
  └──────────── rete interna applicativa ───── backend ───── database
                                                    │
                                                    └──── ollama
```

Compose deve prevedere:

- `frontend`: unico servizio esposto alla rete Docker condivisa con il proxy; serve l'interfaccia e inoltra internamente `/api` al backend;
- `backend`: servizio raggiungibile soltanto sulla rete interna applicativa;
- `database`: servizio e volume persistente non esposti al proxy;
- `ollama`: servizio Docker dedicato, raggiunto dal backend tramite `ollama:11434`;
- rete `app-internal`: rete privata per frontend, backend, database e servizi applicativi;
- rete `proxy-shared`: rete esterna già creata dall'amministratore del proxy;
- rete `ai-egress`: rete Docker separata, collegata soltanto a Ollama per scaricare modelli e comunicare con registry esterni.

Il backend non deve essere collegato alla rete del proxy. Il container frontend deve funzionare da gateway applicativo per `/api`, usando il nome DNS Docker `backend:<porta>` sulla rete interna. Ollama deve essere raggiungibile dal backend tramite il nome DNS `ollama:11434` e non tramite `localhost`. Ollama usa `ai-egress` soltanto per scaricare modelli; backend e database non devono avere accesso diretto a Internet tramite questa rete. Il database non deve pubblicare porte sull'host in produzione. Le porte interne devono essere usate tramite nomi DNS Docker, ad esempio `backend:<porta>`, `database:<porta>` e `ollama:11434`.

### Contratto con il proxy esterno

Il progetto non gestisce TLS, domini, certificati, autenticazione del proxy o regole firewall. Documenta soltanto i requisiti che il proxy deve rispettare:

- inoltrare il traffico web al servizio `frontend`;
- lasciare al container frontend il routing interno di `/api` verso `backend`;
- inoltrare correttamente WebSocket o streaming se usati dalla chat;
- preservare gli header di richiesta necessari;
- mantenere la stessa origine pubblica per frontend e API, quando possibile.

Il frontend deve usare URL relativi come `/api/...`, non `localhost` e non nomi DNS validi soltanto dentro Docker. In questo modo il browser dell'utente comunica sempre con il proxy, mentre soltanto il container frontend conosce il nome interno `backend`.

### Persistenza e configurazione

I dati persistenti devono essere montati tramite volumi o directory dichiarate:

- database e migrazioni;
- campagne e salvataggi;
- log applicativi;
- configurazione locale non sensibile;
- eventuale cache dei modelli o del provider AI.

I modelli Ollama e i dati del servizio devono usare un volume persistente dedicato. Le credenziali e gli indirizzi dei servizi vengono configurati tramite `.env` o secret locali, mai incorporati nell'immagine. Devono essere disponibili profili separati per sviluppo, test e produzione locale, inclusa una modalità senza GPU. Dopo il download dei modelli, l'accesso esterno di Ollama può essere disabilitato nelle installazioni che richiedono isolamento completo.

## 7. Pipeline dei modelli AI

L'applicazione non usa un unico modello generico per tutti i compiti. I modelli sono organizzati per responsabilità e comunicano con il software attraverso contratti strutturati.

### Modelli narrativi

Producono esclusivamente linguaggio naturale:

- narratore;
- dialoghi dei personaggi;
- descrizioni ambientali;
- pensieri e percezioni del protagonista;
- testi di sintesi leggibili dall'utente.

Non possono modificare direttamente database, inventari, posizioni o relazioni.

### Modelli interpreti

Traducono il linguaggio naturale in strutture JSON:

- intenzioni dell'utente;
- azioni richieste;
- domande private al narratore;
- entità nominate;
- informazioni percepite;
- eventi potenziali.

### Modelli di aggiornamento

Producono proposte strutturate per:

- aggiornamenti psicologici;
- nuove memorie;
- variazioni delle relazioni;
- creazione di personaggi, luoghi e oggetti;
- modifiche a inventario, equipaggiamento e missioni.

Le proposte vengono sempre validate dal software prima di essere applicate.

### Modelli riassuntori

Producono riassunti ricostruibili e separati per:

- scena corrente;
- arco narrativo;
- campagna completa;
- stato del protagonista;
- conoscenze di ciascun personaggio;
- fili narrativi aperti.

Il riassunto è una cache del contesto e non sostituisce il registro degli eventi originali.

## 8. Pipeline di un turno

Ogni interazione segue un percorso controllato:

```text
Input dell'utente
    ↓
Interprete linguistico → Intent JSON
    ↓
Validazione dello schema
    ↓
Motore delle regole e delle precondizioni
    ↓
Eventi autorizzati
    ↓
Filtro di percezione e conoscenza
    ↓
Decisioni dei personaggi
    ↓
Proposte di aggiornamento strutturate
    ↓
Transazione sul database
    ↓
Aggiornamento di memorie e riassunti
    ↓
Modello narrativo
    ↓
Risposta all'utente
```

Il narratore riceve lo stato già aggiornato e racconta ciò che è realmente avvenuto. Non deve decidere autonomamente fatti incompatibili con lo stato del database.

## 9. Contesto a livelli

Nessun modello riceve automaticamente l'intera cronologia. Il contesto viene costruito in base al compito e al limite di token configurato.

I livelli disponibili sono:

1. stato corrente: posizione, ora, personaggi presenti, oggetti e condizioni;
2. contesto della scena: ultimi eventi e dialoghi pertinenti;
3. riassunto della scena;
4. riassunto della campagna;
5. memorie selezionate del soggetto coinvolto;
6. regole applicabili al turno;
7. informazioni segrete autorizzate per quel modello.

Il narratore può conoscere i segreti della campagna, mentre un personaggio riceve soltanto ciò che può sapere attraverso percezione, posizione, conversazioni e ricordi.

I riassunti strutturati distinguono sempre:

- fatti confermati;
- supposizioni;
- domande aperte;
- informazioni segrete;
- contraddizioni irrisolte;
- minacce attive;
- obiettivi attivi;
- cambiamenti recenti.

Il riassuntore non può risolvere una contraddizione inventando una versione dei fatti: deve segnalarla al sistema.

## 10. Contratti JSON e sicurezza delle operazioni

Ogni comunicazione fra modello e software usa uno schema JSON versionato. Le strutture possono contenere:

- identificativi reali delle entità;
- operazioni consentite;
- parametri tipizzati;
- precondizioni;
- motivazione;
- livello di confidenza;
- eventi usati come prova;
- destinatari autorizzati a conoscere il risultato.

Per gli aggiornamenti si usano patch limitate, non copie complete delle entità:

```json
{
  "operation": "update_character",
  "characterId": "marta",
  "changes": {
    "trust.protagonist": {
      "from": 42,
      "to": 28,
      "reasonEventId": "event_184"
    }
  }
}
```

Il software verifica sempre che:

- il JSON rispetti lo schema;
- gli ID esistano davvero;
- l'azione sia consentita;
- le precondizioni siano vere;
- l'aggiornamento non modifichi arbitrariamente il passato;
- il personaggio abbia accesso alle informazioni dichiarate;
- inventario, posizione, accessi e relazioni rimangano coerenti;
- il numero di operazioni resti entro il limite del turno.

In caso di JSON non valido è consentito un solo ciclo di correzione automatica, seguito da un errore recuperabile o da una scelta manuale dell'utente. Lo stato precedente non viene perso.

## 11. TurnDirector

Il `TurnDirector` è il componente che coordina l'intero turno. Non è un narratore e non deve dipendere da una singola risposta AI.

È responsabile di:

- scegliere il modello adatto per ogni compito;
- costruire il contesto minimo necessario;
- imporre timeout, budget e numero massimo di tentativi;
- ordinare interpretazione, validazione, simulazione e narrazione;
- rifiutare operazioni non autorizzate;
- applicare gli aggiornamenti in una transazione;
- eseguire rollback in caso di errore;
- registrare modello, prompt, risposta e validazione per la diagnosi;
- impedire cicli infiniti fra narratore e personaggi.

Il flusso standard è quindi linguaggio naturale → intenzione JSON → regole → eventi → aggiornamento dello stato → risposta narrativa.

## 12. Instradamento dei modelli

La configurazione permette di associare modelli diversi a compiti diversi:

- modello narrativo principale per il narratore;
- modello narrativo più piccolo per dialoghi secondari;
- modello JSON per interpretare l'input;
- modello JSON per estrarre entità e aggiornamenti;
- modello riassuntore per memoria e contesto;
- nessun modello per regole, inventario, posizione, accessi e transazioni.

I provider locali devono essere sostituibili senza cambiare il modello dati o l'interfaccia. Ogni compito dispone di un fallback configurabile e di un comportamento definito quando il modello non è disponibile.

## 13. Compiti dell'AI

I compiti AI devono essere separati, con prompt e limiti distinti:

- generazione narrativa;
- interpretazione dell'input dell'utente;
- decisione del personaggio attivo;
- estrazione di nuovi personaggi, oggetti e luoghi;
- aggiornamento dei personaggi;
- aggiornamento delle memorie;
- selezione del parlante;
- generazione di descrizioni;
- pianificazione degli eventi;
- generazione opzionale di immagini o suoni.

Ogni risposta strutturata dell'AI deve essere validata da uno schema. Se il modello fallisce, l'applicazione mantiene il testo già disponibile, registra l'errore e offre un intervento manuale.

## 14. Interfaccia finale

L'interfaccia deve essere utilizzabile da desktop e mobile e comprendere:

- area principale della narrazione;
- input del protagonista;
- pulsante e pannello per il messaggio privato al narratore;
- scheda rapida del protagonista;
- pannello personaggi presenti;
- inventario ed equipaggiamento;
- mappa del luogo corrente;
- timeline degli eventi;
- registro delle missioni e dei fili aperti;
- editor CRUD di personaggi, memorie, luoghi e oggetti;
- visualizzazione delle cause delle decisioni;
- salvataggi, versioni, esportazione e ripristino.

I dialoghi interni dell'app devono essere coerenti e accessibili; le operazioni distruttive richiedono conferma e devono preferire archiviazione o versionamento alla cancellazione definitiva.

## 15. Privacy e funzionamento locale

Per impostazione predefinita:

- testi, memorie e salvataggi restano sul dispositivo;
- l'AI viene eseguita localmente;
- nessun dato viene inviato a servizi esterni senza consenso esplicito;
- i backup sono esportabili in formato leggibile;
- i provider AI sono sostituibili senza modificare il modello dati.

Eventuali funzioni online devono essere opzionali e chiaramente indicate.

## 16. Qualità e verificabilità

Il progetto è considerato funzionante solo quando sono verificabili sia il codice sia il comportamento reale.

Devono essere presenti:

- test del motore dello stato;
- test delle regole di percezione e conoscenza;
- test CRUD delle memorie;
- test di grafo e accessibilità dei luoghi;
- test di salvataggio, caricamento e replay;
- test degli errori del modello AI;
- test di coerenza dell'inventario;
- test dell'interfaccia nei flussi principali;
- una campagna dimostrativa riproducibile.

Lint, build e test statici non sono sufficienti: ogni release deve includere una verifica effettiva del flusso chat, della persistenza, della generazione locale e dell'interfaccia.

## 17. Criteri di successo

Il risultato finale sarà raggiunto quando l'utente potrà:

- creare una campagna e un protagonista;
- esplorare luoghi semplici e complessi;
- parlare con personaggi autonomi e coerenti;
- osservare cambiamenti psicologici motivati;
- modificare le memorie tramite CRUD;
- inviare istruzioni private al narratore;
- verificare cosa ogni personaggio sa davvero;
- usare e trasferire oggetti senza contraddizioni;
- salvare, riprendere, modificare e riprodurre una storia;
- utilizzare il sistema senza dipendere da servizi cloud;
- ottenere errori comprensibili e recuperabili quando l'AI non risponde.

L'obiettivo non è produrre una semplice chat con un prompt fantasy, ma un sistema narrativo persistente: l'AI interpreta il mondo, mentre il software lo conserva, lo limita e ne garantisce la coerenza.
