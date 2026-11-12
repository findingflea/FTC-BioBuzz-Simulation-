# FTC Field Sim

A browser-based 3D simulator for FIRST Tech Challenge robots. Paste in your Java OpMode, and watch a virtual robot run it on a 3D field. There's nothing to install and no robot needed.

> **Live demo:** https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/

---

## What the project does

FTC Field Sim reads the same Java OpMode files you put in your `TeamCode` folder, translates them in the browser, and runs them on a 3D model of the BIOBUZZ field.

- **Autonomous:** paste a `LinearOpMode` and press **Run**. The whole routine is simulated instantly, and you can replay it on a timeline at 0.25× to 4× speed.
- **TeleOp:** press **INIT** and **START**, just like on the Driver Station. Drive with the on-screen gamepad, your keyboard, or a real controller.
- **Full match mode:** a timed match with AUTO (0:30), then "Drivers, pick up your controllers" and a 3-2-1 countdown, then TELEOP (2:00).
  - Switches from your auton program to your TeleOp program automatically
  - Keeps score
  - Stops the robots at the buzzer
- **Game pieces and scoring:**
  - POLLEN is picked up by your intake, launched by your shooter, and flies in 3D
  - Every 4 POLLEN in a HIVE's up cell tips it
  - Points for tips, cells, garden, LEAVE and PARK are added up for each alliance
- **Robot placement:** before auton, drag the robot anywhere along your alliance's wall.
- **Driver Station view:** live telemetry, motor power and encoder readouts, and a console that shows wall hits and errors with line numbers.

### Supported SDK features

| Area | Supported |
| --- | --- |
| OpModes | `LinearOpMode`, `OpMode`, `@Autonomous`, `@TeleOp` |
| Motors | `DcMotor`, `DcMotorEx`: power, direction, encoders, `RUN_TO_POSITION`, velocity, zero-power behavior |
| Servos | `Servo`, `CRServo` |
| Sensors | IMU, distance, color, touch |
| Odometry | goBILDA Pinpoint, SparkFun OTOS |
| Other | `gamepad1`, `gamepad2`, `telemetry`, `ElapsedTime`, `sleep` |
| Drivetrains | Mecanum and tank |

## Why the project is useful

- **Test without a robot.** Write and debug code at home, on a school laptop, or while the robot is being rebuilt.
- **Catch mistakes early.** Spot these before they break the real robot:
  - Reversed motors
  - Wrong encoder math
  - Strafes that turn instead of slide
  - Paths that hit the field
- **Practice driving.** Drivers can rehearse full matches with a real gamepad.
- **Plan autonomous routines.** Try different starting spots and paths, and compare scores.
- **Teach new members.** New programmers instantly see what each line of code does.

## How to get started

### Use it in your browser

1. Open the live demo link above, or download `index.html` and open it in Chrome, Edge or Firefox.
2. Choose **Full match** or **TeleOp / Auton practice**.
3. Paste a complete OpMode file into the **Code** tab, or pick one from **Load an example…**
4. Check the **Hardware map** tab. Device names come from your `hardwareMap.get(...)` calls, and their roles are guessed from the names, so correct any that are wrong. Set which device is the intake, shooter and feeder under **Job**.
5. Adjust the robot on the **Robot** tab: size, wheel size, max speed, launch angle and exit speed.
6. Press **▶ Run** for autonomous, or **INIT → START** for TeleOp.

### Use a real controller

1. Pair the controller in your computer's Bluetooth settings:
   - **PS4:** hold Share + PS until the light flashes
   - **PS5:** hold Create + PS until the light flashes
   - **Xbox:** hold the pair button on top until the logo flashes
   - **Logitech F310:** plug in the USB cable, with the switch on the back set to X
2. Click **Connect controller**, then press any button on the controller.
3. Pick Gamepad 1 or Gamepad 2. Your presses light up on the on-screen gamepad.

### Known limitations

- Physics is approximate, so always fine tune on the real robot.
- Flower positions are approximate and exact geometry of the hive is not entirely accurate.
- NECTAR and vision (AprilTags, OpenCV) are not simulated.
- The other alliance doesn't play yet, so its score shows 0.
- Only one Java file is supported per program.
- The robot cannot go through the 2 hives, as the hives are considered one obstacle in the code.

## Where to get help

- **Issues:** report bugs or ask for features on the [Issues page](https://github.com/YOUR-USERNAME/YOUR-REPO-NAME/issues). Include your code, what you expected, and what happened.
- **In the simulator:** the console shows errors with line numbers, and **Check code** tests your code without running it.
- **FTC rules and SDK:** [FTC Docs](https://ftc-docs.firstinspires.org/) and the [official game manual](https://www.firstinspires.org/resource-library/ftc/game-and-season-info).

## Who maintains and contributes

Maintained by **Rameses Khambatti / Nocturnal#24330**.

Want to help?

1. Fork this repository.
2. Make your change on a new branch.
3. Open a pull request explaining what you changed.

Ideas welcome:
- More SDK features
- An opponent robot for full matches
- Fields from past seasons
- When future seasons come, fields from those seasons

---

*This is an unofficial project and is not affiliated with FIRST®.*
