# Town data

One JSON file per playable town. The game loads `data/towns/<id>.json` and `World.buildTown` draws it onto the 128 x 128 tile grid.

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0.
See <https://www.openstreetmap.org/copyright> and <https://opendatacommons.org/licenses/odbl/1-0/>.

## Where the data comes from

Each town is cut from an export of osm.org, saved as `data/osm/<id>.osm.gz`. The town file is a derived database: it keeps only
the roads (by class), water, building footprints, landmarks (police and bus stations, hospitals, temples, schools,
government offices) and place names inside a 2.0 km square, with points in metres from the square's north-west corner.
Every town file records its source bounds, the date of the latest edit in the export and the attribution line
`Map data © OpenStreetMap contributors, ODbL`. The game shows the credit in the menu.

| Town | Export (latest edit in it) | Export bounds (lat, lon) | Square centred on | RO office anchor |
| --- | --- | --- | --- | --- |
| Pulivendula | `data/osm/pulivendula.osm.gz`, 2026-09-09 | 14.41072, 78.21536 to 14.42865, 78.23446 | 14.4197, 78.2249 | town centre (14.42292, 78.22659) |
| Kadapa | `data/osm/kadapa.osm.gz`, 2026-09-15 | 14.44881, 78.79755 to 14.49269, 78.85094 | 14.4695, 78.8240 (the old town) | Old Collector Office (14.47717, 78.82241) |
| Punganur | `data/osm/punganur.osm.gz`, 2026-08-02 | 13.3606, 78.56388 to 13.37843, 78.57855 | 13.3695, 78.5712 | town point "Punganuru" (13.36405, 78.57305) |

Punganur's export is narrower than the 2.0 km square, so its east and west edges are unmapped open land.
Kadapa's RO office is not at its anchor: the dense old town has no clear space for a walled compound nearer, so the game
builds it about 500 m east of the Old Collector Office.
The exports hold OpenStreetMap's public edit history (contributor names and ids); the town files hold none of it.

## Regenerating

```bash
node scripts/osm-to-town.js kadapa      # data/osm/kadapa.osm.gz -> data/towns/kadapa.json
```

The converter needs no dependencies. Each town's crop centre, RO office anchor and the landmarks to leave out are in
`shared/towns.js`: Kadapa leaves out "police ground", which OSM tags `amenity=police` but is a parade ground, not a station.
Keep every town file at or under 400 KB.
