# Portal-vs-DB Verification Report — 2026-05-13

Generated at: 2026-05-13T17:49:24.725Z
Elapsed: 315.5s
Cohort: `metadata->>upgradeBackfillId='duplicate_cluster_response_upgrade_2026_05_13'` (213 invoice_groups, 214 distinct real Freshdesk tickets)
Mode: read-only scrape +  LLM re-classification (Claude Haiku, same model used in the upgrade)

## Summary

| Verdict | Count | % |
|---|---:|---:|
| match | 212 | 99.5% |
| soft_match | 0 | 0.0% |
| mismatch | 1 | 0.5% |
| scrape_failed | 0 | 0.0% |
| no_carrier_message | 0 | 0.0% |
| **TOTAL** | **213** | 100% |

### Chip re-classification (DB chip vs portal-body re-classified by Claude Haiku)

| Outcome | Count |
|---|---:|
| Re-classifier agrees with stored chip | 212 |
| Re-classifier DISAGREES with stored chip | 1 |
| Re-classifier abstained (LLM error) | 0 |
| Re-classification skipped | 0 |

### Submission status agreement (DB portal_submissions.status vs portal ticket status)

| Outcome | Submissions |
|---|---:|
| Agree | 83 |
| Disagree | 131 |
| Unknown / unmapped portal status | 0 |

## Mismatches (need eyes on) (1)

| Group | Invoice | DB chip | Re-classifier chip | DB body head | Portal body head | Notes |
|---:|---|---|---|---|---|---|
| 191 | 1854889660 | info_request | other | Hi Accounting Agape,

Please see invoice 1856732340

 
 

 document.querySelecto | Hi Accounting Agape,

Please see invoice 1856732340

 
 

 document.querySelecto | chip drift, status drift |

## Chip disagreements (re-classifier chose a different chip than the stored one) (1)

| Group | Invoice | DB chip | Re-classifier chip | DB body head | Portal body head | Notes |
|---:|---|---|---|---|---|---|
| 191 | 1854889660 | info_request | other | Hi Accounting Agape,

Please see invoice 1856732340

 
 

 document.querySelecto | Hi Accounting Agape,

Please see invoice 1856732340

 
 

 document.querySelecto | chip drift, status drift |

## Status drifts (DB submission status disagrees with portal ticket status) (130)

| Group | Invoice | DB chip | Re-classifier chip | DB body head | Portal body head | Notes |
|---:|---|---|---|---|---|---|
| 162 | 1826048390 | acknowledgment | acknowledgment | Hi Accounting Agape,

​You submitted a correction for this on 4/15/26. It was re | Hi Accounting Agape,

​You submitted a correction for this on 4/15/26. It was re | status drift |
| 180 | 1856644670 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 182 | 1854104160 | info_request | info_request | Hi Accounting Agape,

Corrections - Ticket Closed

TPIssues.medanswering.com is  | Hi Accounting Agape,

Corrections - Ticket Closed

TPIssues.medanswering.com is  | status drift |
| 185 | 1855848290 | info_request | info_request | Hi Accounting Agape,

A correction was submitted for this invoice on 4/19/26. Pl | Hi Accounting Agape,

A correction was submitted for this invoice on 4/19/26. Pl | status drift |
| 191 | 1854889660 | info_request | other | Hi Accounting Agape,

Please see invoice 1856732340

 
 

 document.querySelecto | Hi Accounting Agape,

Please see invoice 1856732340

 
 

 document.querySelecto | chip drift, status drift |
| 207 | 1855138880 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 208 | 1855262100 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 211 | 1855241540 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 216 | 1821833240 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 221 | 1854134910 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 234 | 1761882660 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 242 | 1855019540 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 257 | 1854999190 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 265 | 1854528720 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 269 | 1848206320 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 271 | 1801935640 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 292 | 1857105500 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 293 | 1857445340 | denial | denial | GPS Exemption Request Denied
Pickup Location Deviation - Medical Facility - Leg  | GPS Exemption Request Denied
Pickup Location Deviation - Medical Facility - Leg  | status drift |
| 294 | 1858570790 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 295 | 1837957360 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 296 | 1858051570 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 298 | 1851063380 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 307 | 1857746010 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 309 | 1854459080 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 310 | 1835647230 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 315 | 1829732450 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 317 | 1857419810 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 318 | 1858689640 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 319 | 1857915050 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 320 | 1858371470 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 325 | 1848054200 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 327 | 1855902870 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 328 | 1858654520 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 329 | 1859149450 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 331 | 1858351020 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 332 | 1852654940 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 336 | 1851774760 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 337 | 1853940620 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 339 | 1858805330 | denial | denial | GPS Exemption Request Denied
Pickup Location Deviation - Medical Facility - Leg  | GPS Exemption Request Denied
Pickup Location Deviation - Medical Facility - Leg  | status drift |
| 340 | 1851982680 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 341 | 1856567990 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 343 | 1858129690 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 344 | 1858422900 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 346 | 1859192680 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 348 | 1816533060 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 349 | 1803231370 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 350 | 1842287770 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 351 | 1855976160 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 356 | 1858007300 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 358 | 1854872540 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 360 | 1805665470 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 362 | 1852064220 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 363 | 1854423260 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 365 | 1853176210 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 367 | 1858143440 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 374 | 1859645480 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 375 | 1844360240 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 477 | 1861148500 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 482 | 1859682680 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 658 | 1862553750 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 667 | 1865697140 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 848 | 1862909010 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 850 | 1864087690 | denial | denial | GPS Exemption Request Denied
Destination Deviation - Medical Facility - Leg ID 4 | GPS Exemption Request Denied
Destination Deviation - Medical Facility - Leg ID 4 | status drift |
| 852 | 1809612920 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 859 | 1840321750 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 861 | 1863988880 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 863 | 1862553790 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 865 | 1776098570 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 867 | 1852610710 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 868 | 1866664480 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 875 | 1852398780 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 884 | 1865183280 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 888 | 1866853020 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 911 | 1855411380 | denial | denial | GPS Exemption Request Denied
Pickup Location Deviation - Enrollee Residence - Le | GPS Exemption Request Denied
Pickup Location Deviation - Enrollee Residence - Le | status drift |
| 925 | 1866534020 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 948 | 1867835390 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 951 | 1867928680 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 952 | 1867941860 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 958 | 1867530990 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 960 | 1801404270 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 962 | 1865213970 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 968 | 1867258960 | denial | denial | GPS Exemption Request Denied
Destination Deviation - Medical Facility - Leg ID 4 | GPS Exemption Request Denied
Destination Deviation - Medical Facility - Leg ID 4 | status drift |
| 971 | 1867449440 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 973 | 1861558900 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 977 | 1867852730 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 983 | 1868410760 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 984 | 1868404170 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 996 | 1867906190 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1001 | 1868611580 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1008 | 1866208580 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 1009 | 1868728360 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1014 | 1866967230 | denial | denial | GPS Exemption Request Denied
Pickup Location Deviation - Enrollee Residence - Le | GPS Exemption Request Denied
Pickup Location Deviation - Enrollee Residence - Le | status drift |
| 1016 | 1866877090 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1022 | 1864624320 | denial | denial | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | GPS Exemption Request Denied
A detailed review of the GPS data received for invo | status drift |
| 1023 | 1867358700 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1024 | 1867930190 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1027 | 1865291650 | denial | denial | GPS Exemption Request Denied
Pickup Location Deviation - Medical Facility - Leg  | GPS Exemption Request Denied
Pickup Location Deviation - Medical Facility - Leg  | status drift |
| 1028 | 1815911460 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1032 | 1792895920 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1036 | 1865422570 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1037 | 1869348250 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1038 | 1869415480 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1041 | 1869447120 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1045 | 1869452960 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1051 | 1869194970 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1052 | 1854716330 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1053 | 1867514070 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1054 | 1869343940 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1055 | 1859800670 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1057 | 1869698530 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1059 | 1859715960 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1060 | 1869511660 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1061 | 1869386580 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1063 | 1793869460 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1064 | 1869850360 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1065 | 1842066700 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1067 | 1844497880 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1069 | 1866108300 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1070 | 1869989900 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1071 | 1868985360 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1072 | 1844199410 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1073 | 1868842010 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1074 | 1862553830 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1075 | 1870334730 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1076 | 1799585040 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1078 | 1862897820 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1079 | 1863389610 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1080 | 1858908120 | approval | approval | GPS Exemption Request Approved
A detailed review of the GPS data received for in | GPS Exemption Request Approved
A detailed review of the GPS data received for in | status drift |
| 1081 | 1869505550 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |
| 1083 | 1869155350 | denial | denial | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | GPS Exemption Request Denied
Time at Facility Violation
Your Leg 1 GPS end trip  | status drift |

## Methodology

- **Scrape:** Each distinct `portal_submissions.portal_ticket_id` was loaded once via `readPortalTicket()` (the same Playwright code that powers the production cron). The full message thread was parsed.
- **Carrier vs ours:** Messages whose author email matches `MAS_PORTAL_USERNAME` (case-insensitive) are treated as our outbound; everything else is the carrier (the payor). The latest carrier message per ticket is the candidate verdict.
- **Body comparison:** Whitespace-collapsed, lowercased SHA-256 of the candidate verdict vs the stored `portal_responses.content`. `bodyMatchesDb` requires an exact normalized match. `bodyOverlapWithDb` looks for an 80-char prefix overlap either direction (catches portal-side appended footers / signatures).
- **Status comparison:** `portal_submissions.status` ('submitted'/'cancelled') is mapped to expected portal statuses. Open/Pending/Awaiting variants → submitted; Closed/Resolved/Cancelled → cancelled. Any other portal status is recorded as `unknown` (not a failure).
- **Chip re-classification:** The latest carrier body across the group's tickets is fed back through `tryClassifyInboundEmail()` (Claude Haiku, the exact model used in the original upgrade). If the LLM verdict matches the stored `portal_responses.responseType`, the chip is confirmed; if not, it's flagged for review.
- **Overall verdict:** `match` requires exact body + non-disagreeing chip; `soft_match` requires overlap body + non-disagreeing chip; `mismatch` is everything else with a carrier message; `scrape_failed` is when every ticket for the group failed to scrape; `no_carrier_message` is when the scrape succeeded but no non-internal message was found.

## Raw data

Per-group records: `exports/verify-against-portal-2026-05-13.jsonl`.