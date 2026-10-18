# Glossary

- **Candidate**: the player character, a YSRCP nominee in a blue shirt.
- **Supporter**: a townsperson who has joined the candidate's crowd (blue scarf).
- **Crowd**: the candidate's current supporters; its size drives pull, cop lifting and scaring goons and mobs.
- **Town**: one of the three playable real places (Pulivendula, Kadapa, Punganur), identified by a town id.
- **Landmark**: a mapped point of interest kept from OpenStreetMap (police and bus stations, places of worship, hospitals, markets, schools, government offices); police and bus stations become game sites at their real positions (a yard, or a building beside the street where wide roads leave no room).
- **RO Office**: the Returning Officer's compound where nominations are filed (Nomination Day target).
- **Polling Booth**: the compound where the vote is cast (Polling Day target).
- **Nomination**: the set of filing documents; filed when the candidate holds the RO counter.
- **Scrutiny**: the epilogue of Nomination Day. Finishing the counter hold wins the run; then the TDP mob storms the RO Office while the police stand aside, 6 of the 10 filed nominations are snatched (`snatch` events) and torn (the `tear` event), and the run's result carries `scrutiny` = 10 filed, 6 torn, 4 accepted, which the result panel shows. Polling Day has no scrutiny.
- **Goon**: a lone TDP worker who tears the candidate's papers.
- **Mob**: a group of TDP workers in yellow shirts that throws stones and sets fires; police escort it.
- **Leader**: the invented TDP leader of a town; the first member of the town's largest mob (`state.leader`, a mob entity with role 'leader'). Shouts as the nominations are torn.
- **Ally**: the invented YSRCP local leader who joins the candidate with supporters and shields them.
- **Supporter house / vehicle**: a YSRCP supporter's home or parked vehicle; the only things a mob sets on fire. In code they are the `supporterProps` (`map.supporterProps`, `G.supporterProps`), not to be confused with `G.target`, the destination.
- **Fire**: a burning house or vehicle that blocks nearby tiles for a fixed time.
- **Charred**: a house or vehicle after its fire; its tiles are open again and it cannot burn twice.
