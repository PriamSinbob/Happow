# Polityka prywatności

Wersja {{termsVersion}}. Projekt do przeglądu przed publicznym startem.

## 1. Administrator

{{operator}}, {{address}}. Kontakt we wszystkich sprawach danych: {{contactEmail}}.

## 2. Bez konta

- Bez ciasteczek, reklam i śledzenia między stronami.
- Twoja lokalizacja jest używana na telefonie, by pokazać, co jest w pobliżu. Nigdy nie jest przechowywana z niczym, co cię identyfikuje. Zapytanie o mapę wysyła zaokrąglony obszar, nie twoją pozycję.
- By ograniczać nadużycia (dodawanie, zgłoszenia, wyszukiwanie), przechowujemy skrót (z solą) losowego identyfikatora urządzenia i adresu IP przez czas danego limitu (od godziny do doby). Ze skrótu nie da się odtworzyć identyfikatora ani adresu.
- Ustawienia, podświetlona mapa (atlas), zapisane wydarzenia, przypomnienia i obserwowani artyści są w twojej przeglądarce (zob. [pamięć urządzenia](/legal/storage)).
- **Wyszukiwanie:** to, co wpisujesz, trafia na nasz serwer, by udzielić odpowiedzi, i nie jest przechowywane. Jeśli statystyki są włączone, liczymy, że wyszukiwanie się odbyło, bez treści.
- **Obserwowani artyści:** by znaleźć ich wydarzenia, nazwy są wysyłane z zapytaniem i nie są zachowywane.
- **Powiadomienia:** jeśli na nie pozwolisz, adres powiadomień przeglądarki jest przechowywany ze skrótem identyfikatora urządzenia i ustawionymi przypomnieniami.
- **„Idę”, „w drodze”, „jestem”** są przechowywane ze skrótem identyfikatora urządzenia i usuwane {{attendanceKeepHours}} godz. po zakończeniu wydarzenia.

## 3. Z kontem

Przetwarzamy: adres e-mail (i identyfikator konta Google, jeśli logujesz się przez Google), wybrane przez ciebie imię do pokazywania, plan i jego historię, dodane wydarzenia i ich moderację, nagrody za dodane wydarzenia, zapisane wydarzenia, kontakty, grupy, prywatne wydarzenia i zaproszenia, zgłoszenia organizatora, wpisy i poprawki, dodane kalendarze, obserwowanych artystów i powiadomienia o nowych terminach (premium) oraz urządzenia, które dostają twoje powiadomienia.

## 4. Po co i na jakiej podstawie

| Cel                                                                   | Podstawa (RODO)                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Prowadzenie konta i jego funkcji                                      | umowa, art. 6 ust. 1 lit. b                                 |
| Powiadomienia (przypomnienia, komunikaty organizatorów, nowe terminy) | zgoda, art. 6 ust. 1 lit. a, wycofywana wyłączeniem         |
| Zapobieganie nadużyciom, moderacja, bezpieczeństwo                    | prawnie uzasadniony interes, art. 6 ust. 1 lit. f           |
| Pokazywanie publicznych wydarzeń z wykonawcami i organizatorami       | prawnie uzasadniony interes, art. 6 ust. 1 lit. f (zob. §8) |
| Obowiązki prawne (zgłoszenia DSA, rejestry)                           | art. 6 ust. 1 lit. c                                        |

## 5. Kto przetwarza dane w naszym imieniu

- **Supabase** (baza danych i logowanie, region UE) i **Cloudflare** (hosting, API, pamięć podręczna).
- **Anthropic** (Claude): czyta tekst publicznych stron wydarzeń i, gdy z tego korzystasz, zrobione przez ciebie zdjęcie plakatu, by wyciągnąć fakty o wydarzeniu. Poza faktami nic nie zachowujemy; Anthropic nie trenuje modeli na danych z API.
- **Dostawca e-maili**, gdy zaczniemy sami wysyłać wiadomości (kody logowania, powiadomienia).
- **Plausible**, tylko jeśli statystyki są włączone: bez ciasteczek i danych osobowych.
- Serwery map **OpenStreetMap** i **openrouteservice** widzą adres IP urządzenia, gdy rysują mapę i trasy piesze.
- Przekazanie poza EOG (Cloudflare, Anthropic) opiera się na ramach ochrony danych UE–USA albo standardowych klauzulach umownych.

## 6. Jak długo

- Dane konta: do usunięcia konta; potem usuwamy je od razu, poza tym, co musimy zachować z mocy prawa.
- Prośby o kod logowania: {{codeRequestRetentionDays}} dni.
- Prywatne wydarzenia i zaproszenia: {{privateKeepDays}} dni po ich zakończeniu.
- Zakończone zapisane wydarzenia znikają z planu po {{agendaKeepPastDays}} dniach.
- Wysłane powiadomienia o nowych terminach: 30 dni.
- Dodane przez ciebie publiczne wydarzenia zostają, dopóki są przydatne na mapie; usunięcie konta usuwa z nich twoje imię.

## 7. Twoje prawa

Dostęp, sprostowanie, usunięcie, ograniczenie, przenoszenie i sprzeciw. Dane pobierzesz i konto usuniesz sam w O aplikacji → Konto; w pozostałych sprawach napisz na {{contactEmail}}. Możesz złożyć skargę do Prezesa Urzędu Ochrony Danych Osobowych (UODO), ul. Stawki 2, 00-193 Warszawa.

## 8. Osoby wymienione w publicznych ogłoszeniach wydarzeń (art. 14 RODO)

Happow pokazuje publiczne wydarzenia z serwisów biletowych, stron miejsc i organizatorów oraz stron grup Meetup. Gdy wydarzenie wymienia wykonawcę lub organizatora będącego osobą, pokazujemy to imię i nazwisko tak, jak zostało opublikowane, by powiedzieć, kto występuje lub organizuje. Nie tworzymy profili, nie przechowujemy zdjęć osób i nie zbieramy o nich nic więcej.

- **Źródło:** publiczne ogłoszenie, do którego prowadzi wydarzenie.
- **Cel i podstawa:** informowanie o wydarzeniach; prawnie uzasadniony interes (art. 6 ust. 1 lit. f).
- **Jak długo:** dopóki wydarzenie jest ogłaszane, i przez czas, w którym zostaje w archiwum zakończonych wydarzeń.
- **Prawo sprzeciwu:** napisz na {{contactEmail}}; usuniemy lub zanonimizujemy imię i nazwisko w ciągu 48 godzin, chyba że jako organizator chcesz, by zostało.

## 9. Zmiany

Gdy polityka się zmieni, aplikacja poprosi zalogowane osoby o akceptację nowej wersji.
