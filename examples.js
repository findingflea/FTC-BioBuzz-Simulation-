(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});
FTC.EXAMPLES = [
{ id: 'encoder-auto', title: 'Encoder drive (mecanum auton)', code: `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;

@Autonomous(name = "Encoder Square", group = "Robot")
public class EncoderSquare extends LinearOpMode {
    private DcMotor leftFront, rightFront, leftBack, rightBack;
    private final ElapsedTime runtime = new ElapsedTime();

    static final double COUNTS_PER_MOTOR_REV = 537.7;   // goBILDA 312 RPM
    static final double WHEEL_DIAMETER_INCHES = 3.78;   // 96 mm mecanum
    static final double COUNTS_PER_INCH = COUNTS_PER_MOTOR_REV / (WHEEL_DIAMETER_INCHES * Math.PI);
    static final double DRIVE_SPEED = 0.6;
    static final double TURN_SPEED = 0.4;

    @Override
    public void runOpMode() {
        leftFront  = hardwareMap.get(DcMotor.class, "leftFront");
        rightFront = hardwareMap.get(DcMotor.class, "rightFront");
        leftBack   = hardwareMap.get(DcMotor.class, "leftBack");
        rightBack  = hardwareMap.get(DcMotor.class, "rightBack");

        leftFront.setDirection(DcMotor.Direction.REVERSE);
        leftBack.setDirection(DcMotor.Direction.REVERSE);

        for (DcMotor m : new DcMotor[]{leftFront, rightFront, leftBack, rightBack}) {
            m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            m.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
            m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        }

        telemetry.addData("Status", "Ready to run");
        telemetry.update();
        waitForStart();

        // Pull 5 inches off the wall, then drive a 22-inch square, turning right at each corner.
        // The square is small enough to stay clear of the HIVE frame and the wall while turning.
        encoderDrive(DRIVE_SPEED, 5, 5, 5, 5, 2.0);
        for (int side = 0; side < 4 && opModeIsActive(); side++) {
            encoderDrive(DRIVE_SPEED, 22, 22, 22, 22, 4.0);
            encoderDrive(TURN_SPEED, 21.2, -21.2, 21.2, -21.2, 3.0);
        }
        // Strafe right 24 inches
        encoderDrive(DRIVE_SPEED, 24, -24, -24, 24, 4.0);

        telemetry.addData("Path", "Complete");
        telemetry.update();
        sleep(1000);
    }

    /** Move each wheel the given distance (inches) using RUN_TO_POSITION. */
    public void encoderDrive(double speed, double lf, double rf, double lb, double rb, double timeoutS) {
        if (!opModeIsActive()) return;
        leftFront.setTargetPosition(leftFront.getCurrentPosition() + (int) (lf * COUNTS_PER_INCH));
        rightFront.setTargetPosition(rightFront.getCurrentPosition() + (int) (rf * COUNTS_PER_INCH));
        leftBack.setTargetPosition(leftBack.getCurrentPosition() + (int) (lb * COUNTS_PER_INCH));
        rightBack.setTargetPosition(rightBack.getCurrentPosition() + (int) (rb * COUNTS_PER_INCH));

        for (DcMotor m : new DcMotor[]{leftFront, rightFront, leftBack, rightBack}) {
            m.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            m.setPower(Math.abs(speed));
        }
        runtime.reset();
        while (opModeIsActive() && runtime.seconds() < timeoutS
                && (leftFront.isBusy() && rightFront.isBusy() && leftBack.isBusy() && rightBack.isBusy())) {
            telemetry.addData("Target LF", leftFront.getTargetPosition());
            telemetry.addData("Now LF/RF", "%7d : %7d", leftFront.getCurrentPosition(), rightFront.getCurrentPosition());
            telemetry.update();
        }
        for (DcMotor m : new DcMotor[]{leftFront, rightFront, leftBack, rightBack}) {
            m.setPower(0);
            m.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        }
        sleep(150);
    }
}
` },
{ id: 'field-centric', title: 'Field-centric mecanum + arm + claw (TeleOp)', code: `package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.*;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;

@TeleOp(name = "Field Centric Drive")
public class FieldCentricDrive extends LinearOpMode {
    @Override
    public void runOpMode() throws InterruptedException {
        DcMotor frontLeftMotor  = hardwareMap.dcMotor.get("frontLeftMotor");
        DcMotor backLeftMotor   = hardwareMap.dcMotor.get("backLeftMotor");
        DcMotor frontRightMotor = hardwareMap.dcMotor.get("frontRightMotor");
        DcMotor backRightMotor  = hardwareMap.dcMotor.get("backRightMotor");
        DcMotorEx arm = hardwareMap.get(DcMotorEx.class, "arm");
        Servo claw = hardwareMap.get(Servo.class, "claw");

        frontLeftMotor.setDirection(DcMotorSimple.Direction.REVERSE);
        backLeftMotor.setDirection(DcMotorSimple.Direction.REVERSE);
        arm.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        arm.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        arm.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);

        IMU imu = hardwareMap.get(IMU.class, "imu");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP,
                RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));

        boolean clawOpen = false;
        double speed = 1.0;

        waitForStart();
        if (isStopRequested()) return;

        while (opModeIsActive()) {
            double y = -gamepad1.left_stick_y;   // stick up is negative
            double x = gamepad1.left_stick_x * 1.1;
            double rx = gamepad1.right_stick_x;

            if (gamepad1.options) imu.resetYaw();
            if (gamepad1.leftBumperWasPressed()) {
                speed = speed == 1.0 ? 0.4 : 1.0;
                gamepad1.rumble(0.3, 0.3, 150);           // short soft buzz when the speed changes
            }

            double botHeading = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.RADIANS);
            double rotX = x * Math.cos(-botHeading) - y * Math.sin(-botHeading);
            double rotY = x * Math.sin(-botHeading) + y * Math.cos(-botHeading);
            rotX = rotX * 1.1;

            double denominator = Math.max(Math.abs(rotY) + Math.abs(rotX) + Math.abs(rx), 1);
            frontLeftMotor.setPower(speed * (rotY + rotX + rx) / denominator);
            backLeftMotor.setPower(speed * (rotY - rotX + rx) / denominator);
            frontRightMotor.setPower(speed * (rotY - rotX - rx) / denominator);
            backRightMotor.setPower(speed * (rotY + rotX - rx) / denominator);

            arm.setPower(gamepad2.right_trigger - gamepad2.left_trigger + gamepad1.right_trigger - gamepad1.left_trigger);
            if (gamepad1.aWasPressed() || gamepad2.aWasPressed()) {
                clawOpen = !clawOpen;
                gamepad1.rumbleBlips(clawOpen ? 1 : 2);   // haptics: 1 blip = open, 2 = closed
            }
            claw.setPosition(clawOpen ? 0.75 : 0.25);

            telemetry.addData("Heading (deg)", "%.1f", Math.toDegrees(botHeading));
            telemetry.addData("Speed", speed == 1.0 ? "full" : "slow (LB)");
            telemetry.addData("Arm ticks", arm.getCurrentPosition());
            telemetry.addData("Claw", clawOpen ? "open" : "closed");
            telemetry.update();
        }
    }
}
` },
{ id: 'imu-distance', title: 'Drive to wall, IMU turn (auton)', code: `package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.*;
import com.qualcomm.robotcore.util.Range;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

@Autonomous(name = "Wall + IMU Turn")
public class WallAndTurn extends LinearOpMode {
    DcMotor lf, rf, lb, rb;
    IMU imu;
    DistanceSensor front;

    enum Step { DRIVE_TO_WALL, TURN_LEFT, DRIVE_ALONG, DONE }

    @Override
    public void runOpMode() {
        lf = hardwareMap.get(DcMotor.class, "lf");
        rf = hardwareMap.get(DcMotor.class, "rf");
        lb = hardwareMap.get(DcMotor.class, "lb");
        rb = hardwareMap.get(DcMotor.class, "rb");
        lf.setDirection(DcMotorSimple.Direction.REVERSE);
        lb.setDirection(DcMotorSimple.Direction.REVERSE);
        front = hardwareMap.get(DistanceSensor.class, "frontDistance");
        imu = hardwareMap.get(IMU.class, "imu");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP,
                RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));
        imu.resetYaw();

        while (opModeInInit()) {
            telemetry.addData("Front distance (in)", "%.1f", front.getDistance(DistanceUnit.INCH));
            telemetry.addLine("Press START");
            telemetry.update();
        }

        Step step = Step.DRIVE_TO_WALL;
        while (opModeIsActive() && step != Step.DONE) {
            double dist = front.getDistance(DistanceUnit.INCH);
            double yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES);
            switch (step) {
                case DRIVE_TO_WALL:
                    // slow down as we get close, stop at 8 inches
                    double p = Range.clip((dist - 8) * 0.03, 0.15, 0.7);
                    drive(p, 0);
                    if (dist < 8) { drive(0, 0); step = Step.TURN_LEFT; }
                    break;
                case TURN_LEFT:
                    double error = 90 - yaw;
                    double turn = Range.clip(error * 0.02, -0.5, 0.5);
                    if (Math.abs(turn) < 0.08) turn = Math.signum(turn) * 0.08;
                    drive(0, turn);
                    if (Math.abs(error) < 1.5) { drive(0, 0); step = Step.DRIVE_ALONG; }
                    break;
                case DRIVE_ALONG:
                    drive(0.5, (90 - yaw) * 0.02);   // hold heading while driving
                    if (dist < 12) { drive(0, 0); step = Step.DONE; }
                    break;
                default:
                    break;
            }
            telemetry.addData("Step", step);
            telemetry.addData("Distance", "%.1f in", dist);
            telemetry.addData("Yaw", "%.1f deg", yaw);
            telemetry.update();
        }
        sleep(500);
    }

    /** forward: + drives ahead. turn: + turns left (counter-clockwise). */
    private void drive(double forward, double turn) {
        lf.setPower(forward - turn);
        lb.setPower(forward - turn);
        rf.setPower(forward + turn);
        rb.setPower(forward + turn);
    }
}
` },
{ id: 'pinpoint', title: 'Go to points with Pinpoint odometry (auton)', code: `package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Pose2D;

@Autonomous(name = "Pinpoint Waypoints")
public class PinpointWaypoints extends LinearOpMode {
    DcMotor fl, fr, bl, br;
    GoBildaPinpointDriver odo;

    // waypoints relative to the start pose: x forward, y left, inches / degrees
    double[][] path = {
        {26, 0, 0},
        {26, -30, -90},
        {8, -30, -90},
        {8, 0, 0},
    };

    @Override
    public void runOpMode() {
        fl = hardwareMap.get(DcMotor.class, "fl");
        fr = hardwareMap.get(DcMotor.class, "fr");
        bl = hardwareMap.get(DcMotor.class, "bl");
        br = hardwareMap.get(DcMotor.class, "br");
        fl.setDirection(DcMotorSimple.Direction.REVERSE);
        bl.setDirection(DcMotorSimple.Direction.REVERSE);
        for (DcMotor m : new DcMotor[]{fl, fr, bl, br}) m.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);

        odo = hardwareMap.get(GoBildaPinpointDriver.class, "odo");
        odo.setOffsets(-84.0, -168.0, DistanceUnit.MM);
        odo.setEncoderResolution(GoBildaPinpointDriver.GoBildaOdometryPods.goBILDA_4_BAR_POD);
        odo.setEncoderDirections(GoBildaPinpointDriver.EncoderDirection.FORWARD, GoBildaPinpointDriver.EncoderDirection.FORWARD);
        odo.resetPosAndIMU();

        waitForStart();

        for (double[] wp : path) {
            goTo(wp[0], wp[1], wp[2], 4.0);
        }
        stopDrive();
    }

    void goTo(double tx, double ty, double th, double timeout) {
        double start = getRuntime();
        while (opModeIsActive() && getRuntime() - start < timeout) {
            odo.update();
            Pose2D pos = odo.getPosition();
            double x = pos.getX(DistanceUnit.INCH), y = pos.getY(DistanceUnit.INCH);
            double h = pos.getHeading(AngleUnit.RADIANS);
            double ex = tx - x, ey = ty - y;
            double eh = AngleUnit.normalizeRadians(Math.toRadians(th) - h);
            if (Math.hypot(ex, ey) < 0.75 && Math.abs(eh) < Math.toRadians(2)) break;

            // field error -> robot frame
            double fwd = ex * Math.cos(h) + ey * Math.sin(h);
            double left = -ex * Math.sin(h) + ey * Math.cos(h);
            double kP = 0.06;
            double drive = fwd * kP, strafe = -left * kP, turn = -eh * 1.2;
            double max = Math.max(1, Math.abs(drive) + Math.abs(strafe) + Math.abs(turn));
            double scale = 0.8 / max;
            fl.setPower((drive + strafe + turn) * scale);
            bl.setPower((drive - strafe + turn) * scale);
            fr.setPower((drive - strafe - turn) * scale);
            br.setPower((drive + strafe - turn) * scale);

            telemetry.addData("Target", "%.0f, %.0f, %.0f", tx, ty, th);
            telemetry.addData("Pose", "%.1f, %.1f, %.1f", x, y, Math.toDegrees(h));
            telemetry.update();
        }
        stopDrive();
    }

    void stopDrive() {
        fl.setPower(0); fr.setPower(0); bl.setPower(0); br.setPower(0);
    }
}
` },
{ id: 'tank-iterative', title: 'Tank drive, iterative OpMode (TeleOp)', code: `package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.util.ElapsedTime;
import com.qualcomm.robotcore.util.Range;

@TeleOp(name = "Tank Iterative", group = "Iterative")
public class TankIterative extends OpMode {
    private final ElapsedTime runtime = new ElapsedTime();
    private DcMotor leftDrive = null;
    private DcMotor rightDrive = null;
    private DcMotor lift = null;
    private CRServo intake = null;

    @Override
    public void init() {
        leftDrive  = hardwareMap.get(DcMotor.class, "left_drive");
        rightDrive = hardwareMap.get(DcMotor.class, "right_drive");
        lift = hardwareMap.get(DcMotor.class, "lift");
        intake = hardwareMap.get(CRServo.class, "intake");
        leftDrive.setDirection(DcMotor.Direction.REVERSE);
        rightDrive.setDirection(DcMotor.Direction.FORWARD);
        lift.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        telemetry.addData("Status", "Initialized");
    }

    @Override
    public void start() {
        runtime.reset();
    }

    @Override
    public void loop() {
        double drive = -gamepad1.left_stick_y;
        double turn  =  gamepad1.right_stick_x;
        double leftPower  = Range.clip(drive + turn, -1.0, 1.0);
        double rightPower = Range.clip(drive - turn, -1.0, 1.0);
        leftDrive.setPower(leftPower);
        rightDrive.setPower(rightPower);

        // Lift goes to preset heights on the D-pad
        if (gamepad1.dpad_up)   moveLift(2400);
        if (gamepad1.dpad_left) moveLift(1200);
        if (gamepad1.dpad_down) moveLift(0);

        if (gamepad1.right_bumper) intake.setPower(1);
        else if (gamepad1.left_bumper) intake.setPower(-1);
        else intake.setPower(0);

        telemetry.addData("Status", "Run Time: " + runtime.toString());
        telemetry.addData("Motors", "left (%.2f), right (%.2f)", leftPower, rightPower);
        telemetry.addData("Lift", "%d / %d", lift.getCurrentPosition(), lift.getTargetPosition());
    }

    private void moveLift(int target) {
        lift.setTargetPosition(target);
        lift.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        lift.setPower(0.8);
    }

    @Override
    public void stop() {
        leftDrive.setPower(0);
        rightDrive.setPower(0);
    }
}
` },
];
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
