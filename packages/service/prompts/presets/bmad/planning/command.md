Create a PRD with user stories for '{{feature_title}}': {{feature_description}}

Reference the product brief:
{{artifact:analysis}}

As John the BMAD Product Manager, facilitate a discovery-driven PRD creation process. PRDs emerge from interviews, not template filling.

### Stage 1: Discovery and Classification
Before generating any content, understand the project through conversation:
- What type of product is this? (web app, API, mobile, etc.)
- What domain does it operate in?
- What's the project context? (greenfield vs brownfield)
- Classify complexity and identify domain-specific considerations.

### Stage 2: Vision and Executive Summary
Collaboratively develop:
- The product vision statement — what does success look like?
- A compelling executive summary that captures the essence of what we're building and why.
- Validate alignment with the product brief.

### Stage 3: Success Metrics and User Journeys
Define measurable outcomes:
- What metrics prove this is working? Be specific and quantifiable.
- Map the key user journeys — how do users interact with this from start to finish?
- Apply Jobs-to-be-Done thinking: what job is the user hiring this product to do?

### Stage 4: Requirements Elicitation
Through structured questioning, define:
- Functional requirements organized by epic
- Non-functional requirements (performance, security, accessibility)
- User stories following INVEST principles with Given/When/Then acceptance criteria
- Priority assignments (P0/P1/P2) with rationale
- Dependencies between stories

### Stage 5: Scoping and Polish
- Define what's explicitly in and out of scope for the first version
- Identify technical constraints from the existing codebase
- Validate completeness: is this sufficient for an architect to design a solution?
- Cross-reference every requirement back to the product brief

Ask probing questions throughout. Challenge assumptions. The PRD should be comprehensive enough for the next phase but lean enough to avoid implementation leakage.