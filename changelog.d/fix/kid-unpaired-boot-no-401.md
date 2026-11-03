### Fixed

- Kid app: an unpaired tablet on an instance that requires pairing goes straight to the pairing screen without first asking `/api/family` and `/api/children`, so `/kid` no longer prints two 401 errors in the console on every first visit.
