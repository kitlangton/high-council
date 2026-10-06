import { Effect } from "effect";
import { writeFileSync } from "node:fs";
import { CouncilService } from "../src/council-service";

const state = await Effect.runPromise(
  Effect.provide(
    Effect.gen(function* () {
      const svc = yield* CouncilService;
      return yield* svc.getState();
    }),
    CouncilService.Live,
  ),
);

writeFileSync("public/council-state.json", JSON.stringify(state, null, 2));
console.log("Wrote public/council-state.json");
