# Reference musculoskeletal models

These models are used by `scripts/build-force-tables.py`. Their geometry files
are not needed: only muscle paths, moment arms, force capacities, kinematics and
mass properties are used. They are separate from the Z-Anatomy display mesh.

## Gait2392 (CC BY 3.0)

Source: https://github.com/opensim-org/opensim-models/blob/master/Models/Gait2392_Simbody/gait2392_millard2012muscle.osim

Authors: Scott L. Delp, J. Peter Loan, Melissa G. Hoy, Felix E. Zajac,
Eric L. Topp, J. M. Rosen, Darryl G. Thelen, Frank C. Anderson and Ajay Seth.
The source file's complete credits and publication list are retained.

License: https://creativecommons.org/licenses/by/3.0/
Redistribution and adaptation, including commercial use, are permitted with
attribution. No source muscle paths or capacities were edited here. The
application uses a reduced sagittal, quasi-static calculation with ideal force
actuators and assumed vertical ground reactions, not the original gait study.

## MoBL-ARMS (non-commercial use only)

Authors: Katherine R. Saul, Wendy M. Murray, Craig M. Goehler, Melissa Daly,
Meghan E. Vidt and Dustin L. Crouch. Source file adapted by Menthy Denayer (2024):
https://github.com/Menthy-Denayer/OpenSim-BoB-IMU-based-Comparison/blob/main/%5B02%5D%20OpenSim/%5B01%5D%20model%20files/MOBL_ARMS_41_base.osim

This copy changes the default shoulder/elbow posture and segment masses to BoB
fractions, as described in its original header. Those notes are retained.
The original model's use agreement is retained verbatim in `MoBL-license.txt`,
from the distributed MoBL-ARMS tutorial:
https://github.com/aikkala/O2MConverter/blob/master/models/opensim/MoBL_ARMS_OpenSim_tutorial_33/license.txt

The license permits research, academic, evaluation and personal use. Commercial
use requires a commercial license. Retain the notices with derived force tables;
do not treat the data or this source as unrestricted commercial assets.

Required citations:

- Saul KR, Hu X, Goehler CM, Daly M, Vidt ME, Velisar A, Murray WM.
  Benchmarking of dynamic simulation predictions in two software platforms
  using an upper limb musculoskeletal model. Computer Methods in Biomechanics
  and Biomedical Engineering. 2015;18:1445–58.
- McFarland DC, McCain EM, Poppo MN, Saul KR. Spatial Dependency of Glenohumeral
  Joint Stability During Dynamic Unimanual and Bimanual Pushing and Pulling.
  Journal of Biomechanical Engineering. 2019;141(5):051006.
  https://doi.org/10.1115/1.4043035

Our application estimates ideal actuator forces in a reduced shoulder/elbow
model. It does not reproduce or claim the accuracy of the cited studies.

## Build provenance

`muscle-force-tables.json` records source-file SHA-256 hashes, the OpenSim version,
joint constraints, individual maximum forces, load grid, solution forces and
numerical equilibrium residuals. Browser calculations interpolate these solutions
and reject results outside the stated equilibrium tolerance.
