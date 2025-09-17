name: Change Proposal (defer until 100% unless blocker)
about: Propose a change without slowing the current push to 100%
title: "[CP] <concise title>"
labels: enhancement, proposal
body:
  - type: textarea
    attributes:
      label: Problem / Why (link CI logs if applicable)
  - type: textarea
    attributes:
      label: Proposal (scope & files touched; keep tiny if possible)
  - type: textarea
    attributes:
      label: Expected measurable impact (what passes that currently fails?)
  - type: dropdown
    attributes:
      label: Size
      options: [XS, S, M, L]
  - type: textarea
    attributes:
      label: Rollback plan
