# Pamięć urządzenia i ciasteczka

Happow **nie ustawia ciasteczek**. Przechowuje kilka rzeczy w pamięci lokalnej przeglądarki, by aplikacja działała tak, jak ją zostawisz. Nic z tego nie służy reklamie ani śledzeniu i nie opuszcza urządzenia, chyba że wymaga tego dana funkcja.

| Co                                             | Po co                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Język, motyw, zasięg, filtry                   | Aplikacja otwiera się tak, jak ją zostawisz                                    |
| Losowy identyfikator urządzenia                | Limity dodawania i zgłoszeń; do nas trafia tylko jego skrót z solą             |
| Podświetlona mapa (atlas)                      | Miejsca, w których byłeś, na twojej mapie; eksport i czyszczenie w O aplikacji |
| Zapisane wydarzenia, „Idę”                     | Twój plan; synchronizowany z kontem tylko, jeśli je masz                       |
| Obserwowani artyści (do {{followsMax}})        | ★ i „Obserwowani”; synchronizowani tylko z premium i kontem                    |
| Przypomnienia i adres powiadomień              | Powiadomienia, o które prosisz                                                 |
| Sesja logowania                                | Pozostanie zalogowanym; usuwana po wylogowaniu                                 |
| Ostatnie odpowiedzi (obszar mapy, dopasowania) | Szybsze otwieranie i działanie przez chwilę bez sieci                          |

**Service worker** przechowuje pliki aplikacji i ostatnie kafelki mapy, by Happow otwierał się bez połączenia. **Statystyki** (Plausible), jeśli są włączone, działają bez ciasteczek i nic nie zapisują na urządzeniu.

By usunąć wszystko, wyczyść dane strony w ustawieniach przeglądarki; zalogowany możesz też usunąć konto w O aplikacji → Konto.
