# Nazwa
AI Filter for Steam Store

## Krótki opis
Oznacza na żółto lub ukrywa gry z oznaczeniem treści AI podczas przeglądania i wyszukiwania w sklepie Steam.

## Short description
Highlights in yellow or hides games with an AI-generated content disclosure while browsing and searching the Steam store.

## Opis szczegółowy (PL)
Rozszerzenie sprawdza gry wyświetlane w sklepie Steam i wykrywa te, których deweloper zgłosił użycie treści generowanych przez AI („AI Generated Content Disclosure").

Funkcje:
• Żółte oznaczenie kafelków gier z AI (strona główna, wyszukiwarka, promocje, podobne gry, podpowiedzi wyszukiwarki)
• Żółty baner na stronie samej gry
• Panel z przełącznikiem „Ukrywaj gry AI" – działa przy przeglądaniu sklepu i wyszukiwaniu konkretnego tytułu
• Osobne włączanie/wyłączanie oznaczania i ukrywania
• Oznaczanie gier z AI w Twojej bibliotece na steamcommunity.com (skrót „Otwórz moją bibliotekę" w panelu)
• Statystyki bieżącej strony i czyszczenie pamięci podręcznej
• Wszystko działa lokalnie – brak zbierania danych

Uwaga: oznaczenia pochodzą z deklaracji deweloperów na stronach gier. Gry z blokadą wieku mogą nie zostać sprawdzone, jeśli nie masz ustawionej daty urodzenia na koncie Steam.
Rozszerzenie nie jest powiązane z firmą Valve. Steam jest znakiem towarowym Valve Corporation.

## Detailed description (EN)
Detects games in the Steam store whose developers disclosed AI-generated content ("AI Generated Content Disclosure"). Highlights them in yellow and lets you hide them from browsing and search results with one toggle. Everything runs locally; no data is collected. Not affiliated with Valve Corporation.

## Pojedyncze przeznaczenie (Single purpose)
Wykrywanie gier z deklaracją treści AI w sklepie Steam oraz w bibliotece użytkownika i ich oznaczanie lub ukrywanie (w sklepie).

## Uzasadnienia uprawnień (zakładka „Privacy practices")
- storage: zapis ustawień użytkownika, własnego SteamID (tylko do skrótu do biblioteki) i lokalnej pamięci podręcznej wyników (ID gry → ma/nie ma oznaczenia AI).
- Skrypt na steamcommunity.com (strony /profiles/*/games* i /id/*/games*): oznacza gry z AI na liście gier w bibliotece. Dane o AI pobiera service worker ze store.steampowered.com (host permission).
- Host permission https://store.steampowered.com/*: skrypt działa tylko na tej witrynie, odczytuje listę gier na stronie oraz pobiera publiczne strony gier, aby sprawdzić deklarację AI.
- Remote code: NIE używam zdalnego kodu.
- Dane użytkownika: nie zbieram żadnych danych.

## Zasoby graficzne
- Ikona 128x128: icon128.png
- Mały kafelek promocyjny 440x280: promo-tile-440x280.png
- Zrzuty ekranu 
