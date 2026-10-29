# Golden dataset: files in this folder

- `golden_cases.csv`, `golden_parameters.csv`, `golden_tax_bands.csv`, `GOLDEN_FORMAT.md`: the founder's own files, **never edited**.
- `golden_cases_structure_model.csv`: the expectations for cases **4, 5 and 9**, worked the way the payroll engine models pay (one monthly gross split across salary components,
  absence days unpaid, overtime taxed once on top, each component rounded once). The founder's key describes pay as "a rate plus allowances", which the engine's salary
  structures do not have, so those three rows differ from the key for that reason, not because either is mistaken. Each row says why in its `why_different_from_the_key` column.
  The figures are worked by an independent exact-arithmetic calculator (`reference.ts`, `calculateStructureModel`), which also reproduces the key's own figures for the other eight
  cases (a test proves it), and the engine is tested against them. **One difference of tax treatment is for the tax adviser:** the key annualises overtime with the rest of the
  month's pay; the engine taxes overtime once, on top of the annualised regular pay (case 5).
- `reference.ts`, `golden.test.ts`: the calculators and the tests.
