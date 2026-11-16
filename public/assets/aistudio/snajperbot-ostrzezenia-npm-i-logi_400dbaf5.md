# SnajperBot: ostrzeżenia npm i logi kontenera

**Data raportu:** 16 listopada 2026, 23:05 czasu Europe/Warsaw  
**Usługa:** SnajperBot na VPS KVM 2  
**Kontener:** `snajperbot-snajperbot-1`

## Status kontenera

- Kontener został uruchomiony po aktualizacji kodu.
- Panel aplikacji nasłuchuje na porcie `8080`.
- Wcześniejszy test lokalny panelu zwrócił `200 OK`.
- Sekrety środowiskowe nie są zawarte w tym raporcie.

## Ostrzeżenia npm

Podczas instalacji zależności npm zgłoszono:

- **37 podatności łącznie**
- **2 niskie**
- **19 umiarkowanych**
- **14 wysokich**
- **2 krytyczne**

npm zgłosił również, że **199 pakietów szuka finansowania**. Ten komunikat informacyjny nie oznacza błędu aplikacji.

## Fragment logu instalacji

```text
Konfigurowanie pakietów systemowych...
Aktualizacja certyfikatów zakończona
Dodano 683 pakiety, przeskanowano 684 pakiety w 18 s
199 pakietów oczekuje na finansowanie
37 vulnerabilities
- 2 low
- 19 moderate
- 14 high
- 2 critical
```

## Pozostałe komunikaty

W logach pojawiły się komunikaty o braku trybu interaktywnego przy instalacji certyfikatów. W kontenerze jest to normalne zachowanie instalatora i nie jest samo w sobie błędem aplikacji.

## Zalecenie

Nie uruchamiać automatycznie `npm audit fix --force` na produkcji, ponieważ może zaktualizować zależności w sposób powodujący niezgodność z kodem aplikacji. Najpierw należy przeanalizować konkretne pakiety, przygotować aktualizację i ponownie przetestować bota oraz panel.

Raport zawiera podsumowanie ostrzeżeń dostępnych w logach wdrożenia. Nie zawiera pełnej listy nazw podatnych pakietów, ponieważ bieżący odczyt logów nie zwrócił szczegółowego raportu zależności.