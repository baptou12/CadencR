export default {
  cadenceRust: {
    input: {
      target: "http://localhost:45678/api/openapi.json",
    },
    output: {
      target: "./src/renderer/api/generated/index.ts",
      client: "react-query",
      mode: "single",
      override: {
        mutator: {
          path: "./src/renderer/api/client.ts",
          name: "customInstance",
        },
        query: {
          useQuery: true,
          useMutation: true,
        },
      },
    },
  },
};
