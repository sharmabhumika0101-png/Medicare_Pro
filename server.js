const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../frontend/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'doctor-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
});

// Database Connection
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(
            process.env.MONGODB_URI || 'mongodb://localhost:27017/medicare-pro',
            {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            }
        );
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error('Database connection error:', error);
        process.exit(1);
    }
};

// Email transporter setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ============ SCHEMAS ============

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: [true, 'Please provide a name'], trim: true, maxlength: 50 },
    email: {
        type: String, required: [true, 'Please provide an email'], unique: true, lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    password: { type: String, required: [true, 'Please provide a password'], minlength: 6, select: false },
    role: {
        type: String, required: true,
        enum: ['doctor', 'nurse', 'administrator', 'pharmacist', 'lab-technician', 'patient']
    },
    isVerified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// OTP Schema
const otpSchema = new mongoose.Schema({
    email: { type: String, required: true },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true }
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Availability Schema
const availabilitySchema = new mongoose.Schema({
    day: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        required: true
    },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    isAvailable: { type: Boolean, default: true }
});

// Doctor Schema
const doctorSchema = new mongoose.Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    experience: { type: Number, required: true, min: 0 },
    education: { type: String, required: true, trim: true },
    email: {
        type: String, required: true, unique: true, lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    phone: { type: String, required: true, trim: true },
    status: { type: String, enum: ['Available', 'Busy', 'Offline'], default: 'Available' },
    rating: { type: Number, default: 4.5, min: 0, max: 5 },
    profilePhoto: { type: String, default: null },
    avatarSeed: { type: String, default: '50' },
    availability: [availabilitySchema],
    bio: { type: String, maxlength: 500 },
    linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Patient Schema (relaxed defaults so auto-creation never fails)
const patientSchema = new mongoose.Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
    email: {
        type: String, required: true, unique: true, lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    phone: { type: String, trim: true, default: '+1 000 000 0000' },
    bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', null],
        default: null
    },
    status: { type: String, enum: ['Active', 'Critical', 'Discharged'], default: 'Active' },
    address: { type: String, trim: true, default: '' },
    medicalCondition: { type: String, trim: true, default: '' },
    allergies: { type: String, trim: true, default: '' },
    emergencyContact: { type: String, trim: true, default: '' },
    autoCreated: { type: Boolean, default: false },
    linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// ⭐ NEW: Appointment Schema
const appointmentSchema = new mongoose.Schema({
    patientName: { type: String, required: true, trim: true },
    patientId: { type: String, trim: true, default: '' },
    date: { type: String, required: true },     // "YYYY-MM-DD"
    time: { type: String, required: true },     // "HH:MM"
    doctor: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    status: {
        type: String,
        enum: ['scheduled', 'pending', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    notes: { type: String, trim: true, default: '' },
    linkedDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    linkedPatientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

appointmentSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// ============ MEDICATION SCHEMA ============
const batchSchema = new mongoose.Schema({
    batchNumber: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 0, min: 0 },
    expiryDate: { type: Date, required: true },
    receivedDate: { type: Date, default: Date.now },
    supplier: { type: String, trim: true, default: '' }
});

const medicationSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    manufacturer: { type: String, required: true, trim: true },
    strength: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
    expiryDate: { type: Date, required: true },
    minStock: { type: Number, default: 10, min: 0 },
    description: { type: String, maxlength: 500, default: '' },
    batches: [batchSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// ============ PHARMACIST SCHEMA ============
const pharmacistSchema = new mongoose.Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
        type: String, required: true, unique: true, lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    phone: { type: String, trim: true, default: '+1 000 000 0000' },
    licenseNumber: { type: String, trim: true, default: '' },
    specialization: { type: String, trim: true, default: 'General Pharmacy' },
    status: { type: String, enum: ['Available', 'Busy', 'Offline'], default: 'Available' },
    shift: { type: String, enum: ['Morning', 'Afternoon', 'Night', 'Rotating'], default: 'Rotating' },
    autoCreated: { type: Boolean, default: false },
    linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// ============ DEPARTMENT SCHEMA ============
const departmentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    head: { type: String, required: true, trim: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
    location: { type: String, trim: true, default: '' },
    operatingHours: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    headEmail: { type: String, trim: true, lowercase: true, default: '' },
    extension: { type: String, trim: true, default: '' },
    totalBeds: { type: Number, default: 0, min: 0 },
    bedsAvailable: { type: Number, default: 0, min: 0 },
    totalRooms: { type: Number, default: 0, min: 0 },
    doctorsCount: { type: Number, default: 0, min: 0 },
    pharmacistsCount: { type: Number, default: 0, min: 0 },
    nursesCount: { type: Number, default: 0, min: 0 },
    techniciansCount: { type: Number, default: 0, min: 0 },
    adminStaffCount: { type: Number, default: 0, min: 0 },
    staffCount: { type: Number, default: 0, min: 0 },
    services: { type: String, default: '' },
    equipment: { type: String, default: '' },
    description: { type: String, maxlength: 1000, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// ============ STOCK LOG ============
const stockLogSchema = new mongoose.Schema({
    medicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medication', required: true },
    medicationName: { type: String, required: true },
    action: {
        type: String,
        enum: ['create', 'restock', 'edit', 'dispense', 'delete', 'bulk-import', 'adjustment'],
        required: true
    },
    previousQty: { type: Number, default: 0 },
    newQty: { type: Number, default: 0 },
    delta: { type: Number, default: 0 },
    note: { type: String, trim: true, default: '' },
    actorEmail: { type: String, trim: true, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// ============ DISPENSE LOG ============
const dispenseLogSchema = new mongoose.Schema({
    medicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medication', required: true },
    medicationName: { type: String, required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null },
    patientName: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    note: { type: String, trim: true, default: '' },
    actorEmail: { type: String, trim: true, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// ============ VITAL SIGNS SCHEMA ============
const vitalSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    patientName: { type: String, trim: true, default: '' },
    heartRate: { type: Number, min: 0, max: 300, default: null },
    systolic: { type: Number, min: 0, max: 300, default: null },
    diastolic: { type: Number, min: 0, max: 200, default: null },
    hrv: { type: Number, min: 0, max: 500, default: null },
    spo2: { type: Number, min: 0, max: 100, default: null },
    temperature: { type: Number, min: 20, max: 45, default: null },
    respiratoryRate: { type: Number, min: 0, max: 80, default: null },
    bloodGlucose: { type: Number, min: 0, max: 1000, default: null },
    note: { type: String, trim: true, default: '', maxlength: 500 },
    recordedBy: { type: String, trim: true, default: '' },
    recordedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

vitalSchema.pre('save', function(next) {
    this.createdAt = this.createdAt || Date.now();
    next();
});

// ============ PUBLIC VITAL SCHEMA ============
const publicVitalSchema = new mongoose.Schema({
    displayName: { type: String, trim: true, default: '', maxlength: 80 },
    ageRange: { type: String, trim: true, default: '' },
    gender: { type: String, trim: true, default: '' },
    heartRate: { type: Number, min: 0, max: 300, default: null },
    systolic: { type: Number, min: 0, max: 300, default: null },
    diastolic: { type: Number, min: 0, max: 200, default: null },
    hrv: { type: Number, min: 0, max: 500, default: null },
    spo2: { type: Number, min: 0, max: 100, default: null },
    temperature: { type: Number, min: 20, max: 45, default: null },
    respiratoryRate: { type: Number, min: 0, max: 80, default: null },
    bloodGlucose: { type: Number, min: 0, max: 1000, default: null },
    overallLevel: { type: String, default: 'normal' },
    flags: { type: [String], default: [] },
    source: { type: String, enum: ['manual', 'camera-scan', 'bluetooth-device'], default: 'manual' },
    userAgent: { type: String, trim: true, default: '', maxlength: 300 },
    recordedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

// ============ BP CALIBRATION SCHEMA ============
const bpCalibrationSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    systolic: { type: Number, required: true, min: 60, max: 260 },
    diastolic: { type: Number, required: true, min: 40, max: 180 },
    pulseAtCalibration: { type: Number, default: null },
    calibrationDate: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

bpCalibrationSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Update timestamps
doctorSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
patientSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
medicationSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
departmentSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
pharmacistSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });

// Password hashing
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

userSchema.methods.correctPassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Models
const User = mongoose.model('User', userSchema);
const OTP = mongoose.model('OTP', otpSchema);
const Doctor = mongoose.model('Doctor', doctorSchema);
const Patient = mongoose.model('Patient', patientSchema);
const Medication = mongoose.model('Medication', medicationSchema);
const Department = mongoose.model('Department', departmentSchema);
const Pharmacist = mongoose.model('Pharmacist', pharmacistSchema);
const StockLog = mongoose.model('StockLog', stockLogSchema);
const DispenseLog = mongoose.model('DispenseLog', dispenseLogSchema);
const Vital = mongoose.model('Vital', vitalSchema);
const PublicVital = mongoose.model('PublicVital', publicVitalSchema);
const BpCalibration = mongoose.model('BpCalibration', bpCalibrationSchema);

// ⭐ NEW: Register Appointment model
const Appointment = mongoose.model('Appointment', appointmentSchema);

// ============ UTILITIES ============
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOTPEmail = async (email, otp) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'MediCare Pro - OTP Verification',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #1a73e8;">MediCare Pro - OTP Verification</h2>
                    <p>Dear User,</p>
                    <p>Your One-Time Password (OTP) for login verification is:</p>
                    <div style="background-color: #f8f9fa; padding: 20px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #1a73e8; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
                    </div>
                    <p>This OTP is valid for 10 minutes. Please do not share this OTP with anyone.</p>
                    <p>If you didn't request this OTP, please ignore this email.</p>
                    <br>
                    <p>Best regards,<br>MediCare Pro Team</p>
                </div>
            `
        });
        console.log(`OTP sent to ${email}: ${otp}`);
        return true;
    } catch (error) {
        console.error('Error sending OTP email:', error);
        return false;
    }
};

const sendResetPasswordOTPEmail = async (email, otp) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'MediCare Pro - Password Reset Verification',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #1a73e8;">MediCare Pro - Password Reset</h2>
                    <p>Dear User,</p>
                    <p>Your OTP for password reset is:</p>
                    <div style="background-color: #f8f9fa; padding: 20px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #1a73e8; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
                    </div>
                    <p>This OTP is valid for 10 minutes.</p>
                    <br>
                    <p>Best regards,<br>MediCare Pro Team</p>
                </div>
            `
        });
        console.log(`Password reset OTP sent to ${email}: ${otp}`);
        return true;
    } catch (error) {
        console.error('Error sending password reset OTP email:', error);
        return false;
    }
};

const sendLowStockAlertEmail = async (medication, newQty) => {
    const alertTo = process.env.PHARMACY_ALERT_EMAIL || process.env.EMAIL_USER;
    if (!alertTo) {
        console.log('No pharmacy alert email configured, skipping low stock alert');
        return false;
    }
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: alertTo,
            subject: `[MediCare Pro] Low Stock Alert - ${medication.name} ${medication.strength || ''}`.trim(),
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #d93025;">Low Stock Alert</h2>
                    <p><strong>${medication.name} ${medication.strength || ''}</strong> is running low.</p>
                    <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
                        <tr><td style="padding:6px 0;">Current quantity:</td><td style="text-align:right;"><strong>${newQty}</strong></td></tr>
                        <tr><td style="padding:6px 0;">Minimum threshold:</td><td style="text-align:right;"><strong>${medication.minStock}</strong></td></tr>
                        <tr><td style="padding:6px 0;">Category:</td><td style="text-align:right;">${medication.category}</td></tr>
                        <tr><td style="padding:6px 0;">Manufacturer:</td><td style="text-align:right;">${medication.manufacturer}</td></tr>
                        <tr><td style="padding:6px 0;">Unit price:</td><td style="text-align:right;">$${(medication.price || 0).toFixed(2)}</td></tr>
                    </table>
                    <p>Please reorder soon to avoid stockouts.</p>
                    <br>
                    <p>Best regards,<br>MediCare Pro Team</p>
                </div>
            `
        });
        console.log(`Low stock alert sent for ${medication.name}`);
        return true;
    } catch (error) {
        console.error('Error sending low stock alert:', error);
        return false;
    }
};

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET || 'medicare_pro_secret_key_2024', {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
});

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);
    user.password = undefined;
    res.status(statusCode).json({ status: 'success', token, data: { user } });
};

async function writeStockLog({ medicationId, medicationName, action, previousQty, newQty, note = '', actorEmail = '' }) {
    try {
        await StockLog.create({
            medicationId,
            medicationName,
            action,
            previousQty: previousQty || 0,
            newQty: newQty || 0,
            delta: (newQty || 0) - (previousQty || 0),
            note,
            actorEmail
        });
    } catch (err) {
        console.error('Failed to write stock log:', err);
    }
}

// ============================================================
// CASCADE DELETE HELPER
// ============================================================
async function cascadeDeleteUser({ linkedUserId, email, role }) {
    let userDeleted = false;

    if (linkedUserId) {
        try {
            const result = await User.findByIdAndDelete(linkedUserId);
            userDeleted = !!result;
            if (userDeleted) {
                console.log(`   ↳ Deleted User by linkedUserId: ${linkedUserId}`);
            }
        } catch (e) {
            console.warn('   ↳ Delete by linkedUserId failed:', e.message);
        }
    }

    if (!userDeleted && email) {
        try {
            const result = await User.findOneAndDelete({
                email: email.toLowerCase(),
                role
            });
            userDeleted = !!result;
            if (userDeleted) {
                console.log(`   ↳ Deleted User by email + role: ${email} (${role})`);
            }
        } catch (e) {
            console.warn('   ↳ Delete by email+role failed:', e.message);
        }
    }

    return userDeleted;
}

// ============================================================
// AUTO-CREATE FUNCTIONS (CORE OF THE SYNC SYSTEM)
// ============================================================

async function ensureDoctorProfile(user) {
    try {
        let doctor = await Doctor.findOne({
            $or: [
                { email: user.email.toLowerCase() },
                { linkedUserId: user._id }
            ]
        });

        if (doctor) {
            if (!doctor.linkedUserId) {
                doctor.linkedUserId = user._id;
                await doctor.save();
                console.log(`🔗 Linked existing doctor profile to user: ${user.email}`);
            }
            return doctor;
        }

        const nameParts = (user.name || 'Doctor').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Doctor';
        const lastName = nameParts.slice(1).join(' ') || 'User';

        await ensureDepartmentExists('General Medicine', 'Dr. ' + firstName + ' ' + lastName);

        const defaultAvailability = [
            { day: 'Monday', startTime: '09:00', endTime: '17:00', isAvailable: true },
            { day: 'Tuesday', startTime: '09:00', endTime: '17:00', isAvailable: true },
            { day: 'Wednesday', startTime: '09:00', endTime: '17:00', isAvailable: true },
            { day: 'Thursday', startTime: '09:00', endTime: '17:00', isAvailable: true },
            { day: 'Friday', startTime: '09:00', endTime: '17:00', isAvailable: true }
        ];

        doctor = await Doctor.create({
            firstName,
            lastName,
            specialization: 'General Physician',
            department: 'General Medicine',
            experience: 0,
            education: 'To be updated',
            email: user.email.toLowerCase(),
            phone: '+1 000 000 0000',
            status: 'Available',
            rating: 4.5,
            avatarSeed: Math.floor(Math.random() * 90).toString(),
            availability: defaultAvailability,
            bio: `Dr. ${firstName} ${lastName} is a valued member of our medical team.`,
            linkedUserId: user._id
        });

        await updateDepartmentDoctorCount('General Medicine');

        console.log(`✅ Auto-created doctor profile for: ${user.email}`);
        return doctor;
    } catch (error) {
        console.error('❌ Error in ensureDoctorProfile:', error);
        return null;
    }
}

async function ensurePatientProfile(user) {
    try {
        let patient = await Patient.findOne({
            $or: [
                { email: user.email.toLowerCase() },
                { linkedUserId: user._id }
            ]
        });

        if (patient) {
            if (!patient.linkedUserId) {
                patient.linkedUserId = user._id;
                await patient.save();
                console.log(`🔗 Linked existing patient profile to user: ${user.email}`);
            } else {
                console.log(`ℹ️  Patient profile already exists for: ${user.email}`);
            }
            return patient;
        }

        const nameParts = (user.name || 'Patient').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Patient';
        const lastName = nameParts.slice(1).join(' ') || 'User';

        const defaultDOB = new Date();
        defaultDOB.setFullYear(defaultDOB.getFullYear() - 30);
        defaultDOB.setHours(0, 0, 0, 0);

        patient = await Patient.create({
            firstName,
            lastName,
            dateOfBirth: defaultDOB,
            gender: 'Other',
            email: user.email.toLowerCase(),
            phone: '+1 000 000 0000',
            bloodGroup: null,
            status: 'Active',
            address: '',
            medicalCondition: '',
            allergies: '',
            emergencyContact: '',
            autoCreated: true,
            linkedUserId: user._id
        });

        console.log(`✅ Auto-created patient profile for: ${user.email} (${firstName} ${lastName})`);
        return patient;
    } catch (error) {
        console.error('❌ Error in ensurePatientProfile:', error);
        try {
            return await Patient.findOne({ email: user.email.toLowerCase() });
        } catch (e) {
            return null;
        }
    }
}

async function ensurePharmacistProfile(user) {
    try {
        let pharmacist = await Pharmacist.findOne({
            $or: [
                { email: user.email.toLowerCase() },
                { linkedUserId: user._id }
            ]
        });

        if (pharmacist) {
            if (!pharmacist.linkedUserId) {
                pharmacist.linkedUserId = user._id;
                await pharmacist.save();
                console.log(`🔗 Linked existing pharmacist profile to user: ${user.email}`);
            }
            return pharmacist;
        }

        const nameParts = (user.name || 'Pharmacist').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Pharmacist';
        const lastName = nameParts.slice(1).join(' ') || 'User';

        await ensureDepartmentExists('Pharmacy', 'Dr. ' + firstName + ' ' + lastName);

        pharmacist = await Pharmacist.create({
            firstName,
            lastName,
            email: user.email.toLowerCase(),
            phone: '+1 000 000 0000',
            licenseNumber: '',
            specialization: 'General Pharmacy',
            status: 'Available',
            shift: 'Rotating',
            autoCreated: true,
            linkedUserId: user._id
        });

        await updateDepartmentPharmacistCount('Pharmacy');

        console.log(`✅ Auto-created pharmacist profile for: ${user.email}`);
        return pharmacist;
    } catch (error) {
        console.error('❌ Error in ensurePharmacistProfile:', error);
        return null;
    }
}

async function ensureDepartmentExists(departmentName, headName = 'To be assigned') {
    try {
        let dept = await Department.findOne({
            name: { $regex: new RegExp(`^${departmentName.trim()}$`, 'i') }
        });

        if (!dept) {
            dept = await Department.create({
                name: departmentName.trim(),
                code: departmentName.trim().substring(0, 4).toUpperCase(),
                head: headName,
                status: 'Active',
                location: '',
                operatingHours: 'Mon–Fri, 8AM–6PM',
                email: '',
                phone: '',
                headEmail: '',
                extension: '',
                totalBeds: 0,
                bedsAvailable: 0,
                totalRooms: 0,
                doctorsCount: 0,
                pharmacistsCount: 0,
                nursesCount: 0,
                techniciansCount: 0,
                adminStaffCount: 0,
                staffCount: 0,
                services: '',
                equipment: '',
                description: `${departmentName} department`
            });
            console.log(`✅ Auto-created department: ${departmentName}`);
        }
        return dept;
    } catch (error) {
        console.error('Error in ensureDepartmentExists:', error);
        return null;
    }
}

async function updateDepartmentDoctorCount(departmentName) {
    try {
        const count = await Doctor.countDocuments({
            department: { $regex: new RegExp(`^${departmentName.trim()}$`, 'i') }
        });
        await Department.updateOne(
            { name: { $regex: new RegExp(`^${departmentName.trim()}$`, 'i') } },
            { doctorsCount: count }
        );
    } catch (error) {
        console.error('Error updating department doctor count:', error);
    }
}

async function updateDepartmentPharmacistCount(departmentName) {
    try {
        const count = await Pharmacist.countDocuments({});
        await Department.updateOne(
            { name: { $regex: new RegExp(`^${departmentName.trim()}$`, 'i') } },
            { pharmacistsCount: count }
        );
    } catch (error) {
        console.error('Error updating department pharmacist count:', error);
    }
}

async function ensureAllRoleProfiles(user) {
    try {
        const results = { doctor: null, patient: null, pharmacist: null };

        if (!user || !user.role) {
            console.warn('ensureAllRoleProfiles called with invalid user');
            return results;
        }

        if (user.role === 'doctor') {
            results.doctor = await ensureDoctorProfile(user);
        } else if (user.role === 'patient') {
            results.patient = await ensurePatientProfile(user);
        } else if (user.role === 'pharmacist') {
            results.pharmacist = await ensurePharmacistProfile(user);
        }

        return results;
    } catch (error) {
        console.error('Error in ensureAllRoleProfiles:', error);
        return { doctor: null, patient: null, pharmacist: null };
    }
}

// ============ PUBLIC VITAL CLASSIFIERS ============
function classifyHR(v) {
    if (v == null) return null;
    if (v < 40) return { level: 'critical', label: 'Critically Low', advice: 'Seek medical attention immediately.' };
    if (v < 60) return { level: 'low', label: 'Low (Bradycardia)', advice: 'Common in athletes. Consult a doctor if you feel dizzy or tired.' };
    if (v <= 100) return { level: 'normal', label: 'Normal', advice: 'Your resting heart rate is in a healthy range.' };
    if (v <= 120) return { level: 'elevated', label: 'Elevated (Tachycardia)', advice: 'Rest for 5 minutes and recheck.' };
    if (v <= 150) return { level: 'high', label: 'High', advice: 'Recheck after rest. Consult a doctor if it persists.' };
    return { level: 'critical', label: 'Critically High', advice: 'Seek medical attention immediately.' };
}
function classifySystolic(v) {
    if (v == null) return null;
    if (v < 80) return { level: 'critical', label: 'Critically Low', advice: 'Seek medical attention immediately.' };
    if (v < 90) return { level: 'low', label: 'Low', advice: 'Drink water, sit down, and recheck.' };
    if (v < 120) return { level: 'normal', label: 'Normal', advice: 'Systolic pressure is in a healthy range.' };
    if (v < 130) return { level: 'elevated', label: 'Elevated', advice: 'Monitor regularly.' };
    if (v < 140) return { level: 'high', label: 'High (Stage 1)', advice: 'Reduce salt, exercise, and consult a doctor.' };
    if (v < 180) return { level: 'high', label: 'High (Stage 2)', advice: 'Consult a doctor soon.' };
    return { level: 'critical', label: 'Hypertensive Crisis', advice: 'Seek medical care immediately.' };
}
function classifyDiastolic(v) {
    if (v == null) return null;
    if (v < 50) return { level: 'critical', label: 'Critically Low', advice: 'Seek medical attention immediately.' };
    if (v < 60) return { level: 'low', label: 'Low', advice: 'Recheck after resting.' };
    if (v < 80) return { level: 'normal', label: 'Normal', advice: 'Diastolic pressure is in a healthy range.' };
    if (v < 85) return { level: 'elevated', label: 'Elevated', advice: 'Monitor regularly.' };
    if (v < 90) return { level: 'high', label: 'High (Stage 1)', advice: 'Consult a doctor if sustained.' };
    if (v < 120) return { level: 'high', label: 'High (Stage 2)', advice: 'Consult a doctor soon.' };
    return { level: 'critical', label: 'Hypertensive Crisis', advice: 'Seek medical care immediately.' };
}
function classifyHRV(v) {
    if (v == null) return null;
    if (v < 15) return { level: 'low', label: 'Very Low', advice: 'Often linked to stress or fatigue.' };
    if (v < 30) return { level: 'low', label: 'Low', advice: 'Rest, hydrate, and reduce stress.' };
    if (v <= 100) return { level: 'normal', label: 'Normal', advice: 'Good autonomic balance.' };
    return { level: 'elevated', label: 'High', advice: 'Recheck after rest.' };
}
function classifySpo2(v) {
    if (v == null) return null;
    if (v < 88) return { level: 'critical', label: 'Critically Low', advice: 'Seek medical help immediately.' };
    if (v < 92) return { level: 'high', label: 'Low', advice: 'Consult a doctor if short of breath.' };
    if (v < 95) return { level: 'elevated', label: 'Slightly Low', advice: 'Take slow deep breaths and recheck.' };
    return { level: 'normal', label: 'Normal', advice: 'Oxygen saturation is healthy.' };
}
function classifyTemperature(v) {
    if (v == null) return null;
    if (v < 34) return { level: 'critical', label: 'Hypothermic', advice: 'Warm up and seek medical help.' };
    if (v < 36) return { level: 'low', label: 'Low', advice: 'Keep warm and recheck.' };
    if (v <= 37.5) return { level: 'normal', label: 'Normal', advice: 'Body temperature is normal.' };
    if (v <= 38.5) return { level: 'elevated', label: 'Low-grade Fever', advice: 'Hydrate and rest.' };
    if (v <= 39.5) return { level: 'high', label: 'Fever', advice: 'Take an antipyretic if needed, consult a doctor.' };
    return { level: 'critical', label: 'High Fever', advice: 'Seek medical attention.' };
}
function classifyRespiratoryRate(v) {
    if (v == null) return null;
    if (v < 8) return { level: 'critical', label: 'Critically Low', advice: 'Seek medical help.' };
    if (v < 12) return { level: 'low', label: 'Low', advice: 'Recheck at rest.' };
    if (v <= 20) return { level: 'normal', label: 'Normal', advice: 'Breathing rate is healthy.' };
    if (v <= 24) return { level: 'elevated', label: 'Elevated', advice: 'Rest and recheck.' };
    if (v <= 30) return { level: 'high', label: 'High', advice: 'Consult a doctor if persistent.' };
    return { level: 'critical', label: 'Critically High', advice: 'Seek medical help immediately.' };
}
function classifyGlucose(v) {
    if (v == null) return null;
    if (v < 54) return { level: 'critical', label: 'Hypoglycemia', advice: 'Eat fast-acting sugar and seek help.' };
    if (v < 70) return { level: 'low', label: 'Low', advice: 'Have a small snack and recheck.' };
    if (v <= 140) return { level: 'normal', label: 'Normal', advice: 'Blood glucose is in range.' };
    if (v <= 200) return { level: 'elevated', label: 'Elevated', advice: 'Monitor regularly.' };
    if (v <= 400) return { level: 'high', label: 'High', advice: 'Consult a doctor soon.' };
    return { level: 'critical', label: 'Severely High', advice: 'Seek medical help.' };
}

const PUBLIC_CLASSIFIERS = {
    heartRate: classifyHR,
    systolic: classifySystolic,
    diastolic: classifyDiastolic,
    hrv: classifyHRV,
    spo2: classifySpo2,
    temperature: classifyTemperature,
    respiratoryRate: classifyRespiratoryRate,
    bloodGlucose: classifyGlucose
};

function analyzeVitals(input) {
    const order = { critical: 4, high: 3, elevated: 2, low: 1, normal: 0 };
    const breakdown = {};
    const flags = [];
    let worst = 'normal';

    for (const key of Object.keys(PUBLIC_CLASSIFIERS)) {
        const val = input[key];
        if (val == null || isNaN(val)) continue;
        const result = PUBLIC_CLASSIFIERS[key](Number(val));
        if (!result) continue;
        breakdown[key] = { value: Number(val), ...result };
        if (order[result.level] > order[worst]) worst = result.level;
        if (result.level === 'critical' || result.level === 'high') {
            const friendly = {
                heartRate: 'heart rate', systolic: 'systolic BP', diastolic: 'diastolic BP',
                hrv: 'HRV', spo2: 'SpO₂', temperature: 'temperature',
                respiratoryRate: 'respiratory rate', bloodGlucose: 'blood glucose'
            }[key] || key;
            flags.push(`${result.label} ${friendly}`);
        }
    }

    return { overallLevel: worst, breakdown, flags };
}

// ============ PAGE ROUTES ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dashboard.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dashboard.html')));
app.get('/loginpg.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/loginpg.html')));
app.get('/doctors.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/doctors.html')));
app.get('/departments.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/departments.html')));
app.get('/patients.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/patients.html')));
app.get('/pharmacy.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/pharmacy.html')));
app.get('/appointment.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/appointment.html')));
app.get('/forgotpassword.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/forgotpassword.html')));
app.get('/vitals.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/vitals.html')));
app.get('/vitals-checker.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/vitals-checker.html')));
app.get('/vitals-scan.html', (req, res) => res.sendFile(path.join(__dirname, '../frontend/vitals-scan.html')));

// ============ PUBLIC CONFIG ============
app.get('/api/config', (req, res) => {
    res.json({
        status: 'success',
        data: {
            googleClientId: process.env.GOOGLE_CLIENT_ID || ''
        }
    });
});

// ============ AUTH ROUTES (WITH AUTO-SYNC) ============
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password, passwordConfirm, role } = req.body;
        if (!name || !email || !password || !passwordConfirm || !role) {
            return res.status(400).json({ status: 'error', message: 'All fields are required' });
        }
        if (password !== passwordConfirm) {
            return res.status(400).json({ status: 'error', message: 'Passwords do not match' });
        }
        if (password.length < 6) {
            return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ status: 'error', message: 'User already exists with this email' });
        }
        const newUser = await User.create({ name, email, password, role });

        const roleResults = await ensureAllRoleProfiles(newUser);

        const responsePayload = {
            status: 'success',
            token: signToken(newUser._id),
            data: {
                user: { ...newUser.toObject(), password: undefined },
                autoCreated: {
                    doctor: !!roleResults.doctor,
                    patient: !!roleResults.patient,
                    pharmacist: !!roleResults.pharmacist
                }
            }
        };

        console.log(`✅ Signup complete for ${email} (role: ${role})`);
        res.status(201).json(responsePayload);
    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ status: 'error', message: 'Please provide email and password' });
        }
        const user = await User.findOne({ email }).select('+password');
        if (!user) return res.status(401).json({ status: 'error', message: 'Incorrect email or password' });
        const isPasswordCorrect = await user.correctPassword(password);
        if (!isPasswordCorrect) return res.status(401).json({ status: 'error', message: 'Incorrect email or password' });

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await OTP.deleteMany({ email });
        await OTP.create({ email, otp, expiresAt });
        const emailSent = await sendOTPEmail(email, otp);
        if (!emailSent) return res.status(500).json({ status: 'error', message: 'Failed to send OTP email' });

        res.status(200).json({ status: 'success', message: 'OTP sent to your email', data: { email, userId: user._id } });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ status: 'error', message: 'Please provide email and OTP' });
        const otpRecord = await OTP.findOne({ email, otp, expiresAt: { $gt: new Date() } });
        if (!otpRecord) return res.status(400).json({ status: 'error', message: 'Invalid or expired OTP' });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });

        const roleResults = await ensureAllRoleProfiles(user);

        await OTP.deleteOne({ _id: otpRecord._id });

        const token = signToken(user._id);
        user.password = undefined;
        res.status(200).json({
            status: 'success',
            token,
            data: {
                user,
                autoCreated: {
                    doctor: !!roleResults.doctor,
                    patient: !!roleResults.patient,
                    pharmacist: !!roleResults.pharmacist
                }
            }
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email is required' });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await OTP.deleteMany({ email });
        await OTP.create({ email, otp, expiresAt });
        const emailSent = await sendOTPEmail(email, otp);
        if (!emailSent) return res.status(500).json({ status: 'error', message: 'Failed to send OTP email' });
        res.status(200).json({ status: 'success', message: 'New OTP sent to your email' });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email is required' });
        const user = await User.findOne({ email });
        if (!user) return res.status(200).json({ status: 'success', message: 'If the email is registered, you will receive a verification code' });
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await OTP.deleteMany({ email });
        await OTP.create({ email, otp, expiresAt });
        const emailSent = await sendResetPasswordOTPEmail(email, otp);
        if (!emailSent) return res.status(500).json({ status: 'error', message: 'Failed to send verification email' });
        res.status(200).json({ status: 'success', message: 'Verification code sent to your email' });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ status: 'error', message: 'Please provide email and OTP' });
        const otpRecord = await OTP.findOne({ email, otp, expiresAt: { $gt: new Date() } });
        if (!otpRecord) return res.status(400).json({ status: 'error', message: 'Invalid or expired verification code' });
        const resetToken = jwt.sign(
            { email, purpose: 'password_reset', otpId: otpRecord._id },
            process.env.JWT_SECRET || 'medicare_pro_secret_key_2024',
            { expiresIn: '15m' }
        );
        res.status(200).json({ status: 'success', message: 'OTP verified successfully', resetToken });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { resetToken, newPassword, confirmPassword } = req.body;
        if (!resetToken || !newPassword || !confirmPassword) {
            return res.status(400).json({ status: 'error', message: 'Reset token and new password are required' });
        }
        if (newPassword !== confirmPassword) return res.status(400).json({ status: 'error', message: 'Passwords do not match' });
        if (newPassword.length < 6) return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
        const decoded = jwt.verify(resetToken, process.env.JWT_SECRET || 'medicare_pro_secret_key_2024');
        if (decoded.purpose !== 'password_reset') return res.status(400).json({ status: 'error', message: 'Invalid reset token' });
        const user = await User.findOne({ email: decoded.email });
        if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
        user.password = newPassword;
        await user.save();
        await OTP.deleteOne({ _id: decoded.otpId });
        res.status(200).json({ status: 'success', message: 'Password reset successfully' });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(400).json({ status: 'error', message: 'Invalid or expired reset token' });
        }
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/auth/resend-reset-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email is required' });
        const user = await User.findOne({ email });
        if (!user) return res.status(200).json({ status: 'success', message: 'If the email is registered, you will receive a verification code' });
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await OTP.deleteMany({ email });
        await OTP.create({ email, otp, expiresAt });
        const emailSent = await sendResetPasswordOTPEmail(email, otp);
        if (!emailSent) return res.status(500).json({ status: 'error', message: 'Failed to send verification email' });
        res.status(200).json({ status: 'success', message: 'New verification code sent to your email' });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.get('/api/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ status: 'error', message: 'Please login to access this resource' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'medicare_pro_secret_key_2024');
        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ status: 'error', message: 'User no longer exists' });
        res.status(200).json({ status: 'success', data: { user } });
    } catch (error) {
        res.status(401).json({ status: 'error', message: 'Invalid token' });
    }
});

// ============ GOOGLE SIGN-IN ROUTE ============
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.post('/api/auth/google', async (req, res) => {
    try {
        if (!googleClient) {
            return res.status(500).json({
                status: 'error',
                message: 'Google Sign-In is not configured on the server. Set GOOGLE_CLIENT_ID in .env'
            });
        }

        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ status: 'error', message: 'Google ID token is required' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const { email, name, email_verified } = payload;

        if (!email || !email_verified) {
            return res.status(400).json({ status: 'error', message: 'Google account email not verified' });
        }

        let user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            const randomPassword = crypto.randomBytes(20).toString('hex');

            user = await User.create({
                name: name || email.split('@')[0],
                email: email.toLowerCase(),
                password: randomPassword,
                role: 'administrator',
                isVerified: true
            });

            console.log(`New user created via Google Sign-In: ${email}`);
        } else if (!user.isVerified) {
            user.isVerified = true;
            await user.save();
        }

        await ensureAllRoleProfiles(user);

        createSendToken(user, 200, res);
    } catch (error) {
        console.error('Google auth error:', error);
        res.status(401).json({
            status: 'error',
            message: 'Google sign-in failed: ' + (error.message || 'Invalid token')
        });
    }
});

// ============ DOCTOR ROUTES ============
app.post('/api/doctors/check-availability', async (req, res) => {
    try {
        const { doctorId, day, time } = req.body;
        if (!doctorId || !day || !time) return res.status(400).json({ status: 'error', message: 'Doctor ID, day, and time are required' });
        const doctor = await Doctor.findById(doctorId);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
        const availability = doctor.availability.find(a => a.day === day && a.isAvailable);
        if (!availability) return res.status(200).json({ status: 'success', data: { isAvailable: false, message: 'Doctor is not available on this day' } });
        const isTimeAvailable = time >= availability.startTime && time <= availability.endTime;
        res.status(200).json({
            status: 'success',
            data: {
                isAvailable: isTimeAvailable,
                availableHours: { start: availability.startTime, end: availability.endTime },
                message: isTimeAvailable ? 'Doctor is available at this time' : 'Doctor is not available at this time'
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to check availability' });
    }
});

app.get('/api/doctors/:id/availability/:day', async (req, res) => {
    try {
        const { id, day } = req.params;
        const doctor = await Doctor.findById(id);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
        const availability = doctor.availability.filter(a => a.day === day && a.isAvailable);
        res.status(200).json({ status: 'success', data: availability });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to get availability' });
    }
});

app.get('/api/doctors', async (req, res) => {
    try {
        const doctors = await Doctor.find().sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: doctors });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch doctors' });
    }
});

app.get('/api/doctors/:id', async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
        res.status(200).json({ status: 'success', data: doctor });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch doctor' });
    }
});

app.post('/api/doctors', async (req, res) => {
    try {
        const { firstName, lastName, specialization, department, experience, education, email, phone, bio, status, rating, availability } = req.body;
        if (!firstName || !lastName || !specialization || !department || !experience || !education || !email || !phone) {
            return res.status(400).json({ status: 'error', message: 'All fields are required' });
        }
        const existingDoctor = await Doctor.findOne({ email });
        if (existingDoctor) return res.status(400).json({ status: 'error', message: 'A doctor with this email already exists' });

        let availabilityData = (availability && Array.isArray(availability)) ? availability : [];
        let doctorRating = (rating && !isNaN(rating) && rating >= 0 && rating <= 5) ? rating : 4.5;

        const newDoctor = await Doctor.create({
            firstName, lastName, specialization, department, experience, education, email, phone,
            bio: bio || '', availability: availabilityData,
            status: status || 'Available', rating: doctorRating,
            avatarSeed: Math.floor(Math.random() * 90).toString()
        });

        await updateDepartmentDoctorCount(department);

        res.status(201).json({ status: 'success', data: newDoctor });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ status: 'error', message: 'A doctor with this email already exists' });
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.put('/api/doctors/:id', async (req, res) => {
    try {
        const { firstName, lastName, specialization, department, experience, education, email, phone, bio, status, rating, availability } = req.body;
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });

        if (email && email !== doctor.email) {
            const existingDoctor = await Doctor.findOne({ email });
            if (existingDoctor) return res.status(400).json({ status: 'error', message: 'A doctor with this email already exists' });
        }

        const oldDepartment = doctor.department;

        doctor.firstName = firstName || doctor.firstName;
        doctor.lastName = lastName || doctor.lastName;
        doctor.specialization = specialization || doctor.specialization;
        doctor.department = department || doctor.department;
        doctor.experience = experience !== undefined ? experience : doctor.experience;
        doctor.education = education || doctor.education;
        doctor.email = email || doctor.email;
        doctor.phone = phone || doctor.phone;
        if (bio !== undefined) doctor.bio = bio;
        if (status !== undefined) doctor.status = status;
        if (rating !== undefined && !isNaN(rating) && rating >= 0 && rating <= 5) doctor.rating = rating;
        if (availability !== undefined) doctor.availability = availability;

        await doctor.save();

        if (oldDepartment !== doctor.department) {
            await updateDepartmentDoctorCount(oldDepartment);
            await updateDepartmentDoctorCount(doctor.department);
        }

        res.status(200).json({ status: 'success', data: doctor });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/doctors/:id/photo', upload.single('profilePhoto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded' });
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
        if (doctor.profilePhoto) {
            const oldPhotoPath = path.join(__dirname, '../frontend', doctor.profilePhoto);
            if (fs.existsSync(oldPhotoPath)) fs.unlinkSync(oldPhotoPath);
        }
        const photoUrl = '/uploads/' + req.file.filename;
        doctor.profilePhoto = photoUrl;
        await doctor.save();
        res.status(200).json({ status: 'success', data: { profilePhoto: photoUrl } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to upload photo' });
    }
});

app.delete('/api/doctors/:id/photo', async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
        if (!doctor.profilePhoto) return res.status(400).json({ status: 'error', message: 'No photo to delete' });
        const photoPath = path.join(__dirname, '../frontend', doctor.profilePhoto);
        if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
        doctor.profilePhoto = null;
        await doctor.save();
        res.status(200).json({ status: 'success', message: 'Photo deleted successfully' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to delete photo' });
    }
});

app.delete('/api/doctors/:id', async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.params.id);
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });

        console.log(`🗑️  Deleting doctor: ${doctor.email} (${doctor.firstName} ${doctor.lastName})`);

        if (doctor.profilePhoto) {
            const photoPath = path.join(__dirname, '../frontend', doctor.profilePhoto);
            if (fs.existsSync(photoPath)) {
                try { fs.unlinkSync(photoPath); } catch (e) { console.warn('Photo delete failed:', e.message); }
            }
        }

        const userDeleted = await cascadeDeleteUser({
            linkedUserId: doctor.linkedUserId,
            email: doctor.email,
            role: 'doctor'
        });

        await Doctor.findByIdAndDelete(req.params.id);

        await updateDepartmentDoctorCount(doctor.department);

        res.status(200).json({
            status: 'success',
            message: userDeleted
                ? 'Doctor and linked user account deleted. They can sign up again.'
                : 'Doctor profile deleted. (No linked user account was found.)',
            data: { userDeleted }
        });
    } catch (error) {
        console.error('Delete doctor error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete doctor' });
    }
});

app.patch('/api/doctors/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['Available', 'Busy', 'Offline'].includes(status)) return res.status(400).json({ status: 'error', message: 'Invalid status' });
        const doctor = await Doctor.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
        if (!doctor) return res.status(404).json({ status: 'error', message: 'Doctor not found' });
        res.status(200).json({ status: 'success', data: doctor });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to update status' });
    }
});

app.post('/api/doctors/sync', async (req, res) => {
    try {
        const doctorUsers = await User.find({ role: 'doctor' });
        const results = { created: 0, alreadyExists: 0, errors: [] };
        for (const user of doctorUsers) {
            try {
                const existingDoctor = await Doctor.findOne({ $or: [{ email: user.email }, { linkedUserId: user._id }] });
                if (existingDoctor) { results.alreadyExists++; continue; }
                await ensureDoctorProfile(user);
                results.created++;
            } catch (err) {
                results.errors.push({ email: user.email, error: err.message });
            }
        }
        res.status(200).json({ status: 'success', message: 'Doctor profiles synced', data: results });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to sync doctor profiles' });
    }
});

// ============ PHARMACIST ROUTES ============
app.get('/api/pharmacists', async (req, res) => {
    try {
        const pharmacists = await Pharmacist.find().sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: pharmacists });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch pharmacists' });
    }
});

app.post('/api/pharmacists/sync', async (req, res) => {
    try {
        const pharmacistUsers = await User.find({ role: 'pharmacist' });
        const results = { created: 0, alreadyExists: 0, errors: [] };
        for (const user of pharmacistUsers) {
            try {
                const existing = await Pharmacist.findOne({ $or: [{ email: user.email }, { linkedUserId: user._id }] });
                if (existing) { results.alreadyExists++; continue; }
                await ensurePharmacistProfile(user);
                results.created++;
            } catch (err) {
                results.errors.push({ email: user.email, error: err.message });
            }
        }
        res.status(200).json({ status: 'success', message: 'Pharmacist profiles synced', data: results });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to sync pharmacist profiles' });
    }
});

app.delete('/api/pharmacists/:id', async (req, res) => {
    try {
        const pharmacist = await Pharmacist.findById(req.params.id);
        if (!pharmacist) return res.status(404).json({ status: 'error', message: 'Pharmacist not found' });

        console.log(`🗑️  Deleting pharmacist: ${pharmacist.email} (${pharmacist.firstName} ${pharmacist.lastName})`);

        const userDeleted = await cascadeDeleteUser({
            linkedUserId: pharmacist.linkedUserId,
            email: pharmacist.email,
            role: 'pharmacist'
        });

        await Pharmacist.findByIdAndDelete(req.params.id);

        await updateDepartmentPharmacistCount('Pharmacy');

        res.status(200).json({
            status: 'success',
            message: userDeleted
                ? 'Pharmacist and linked user account deleted. They can sign up again.'
                : 'Pharmacist profile deleted. (No linked user account was found.)',
            data: { userDeleted }
        });
    } catch (error) {
        console.error('Delete pharmacist error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete pharmacist' });
    }
});

// ============ DEPARTMENT ROUTES ============
app.get('/api/departments', async (req, res) => {
    try {
        const departments = await Department.find().sort({ createdAt: -1 });
        const enriched = await Promise.all(departments.map(async (dept) => {
            const obj = dept.toObject();
            obj.doctorsCount = await Doctor.countDocuments({
                department: { $regex: new RegExp(`^${dept.name.trim()}$`, 'i') }
            });
            return obj;
        }));
        res.status(200).json({ status: 'success', data: enriched });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch departments' });
    }
});

app.get('/api/departments/:id', async (req, res) => {
    try {
        const department = await Department.findById(req.params.id);
        if (!department) return res.status(404).json({ status: 'error', message: 'Department not found' });
        res.status(200).json({ status: 'success', data: department });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch department' });
    }
});

app.post('/api/departments', async (req, res) => {
    try {
        const { name, code, head, status, location, operatingHours, email, phone, headEmail, extension, totalBeds, bedsAvailable, totalRooms, nursesCount, techniciansCount, adminStaffCount, staffCount, services, equipment, description } = req.body;
        if (!name || !head) return res.status(400).json({ status: 'error', message: 'Name and head are required' });
        const existing = await Department.findOne({ name: name.trim() });
        if (existing) return res.status(400).json({ status: 'error', message: 'A department with this name already exists' });
        const liveDoctors = await Doctor.countDocuments({ department: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
        const newDept = await Department.create({
            name: name.trim(), code: code ? code.trim().toUpperCase() : '', head: head.trim(),
            status: status || 'Active',
            location: location || '', operatingHours: operatingHours || '',
            email: email || '', phone: phone || '', headEmail: headEmail || '', extension: extension || '',
            totalBeds: totalBeds || 0, bedsAvailable: bedsAvailable || 0, totalRooms: totalRooms || 0,
            doctorsCount: liveDoctors,
            nursesCount: nursesCount || 0, techniciansCount: techniciansCount || 0,
            adminStaffCount: adminStaffCount || 0, staffCount: staffCount || 0,
            services: services || '', equipment: equipment || '', description: description || ''
        });
        res.status(201).json({ status: 'success', data: newDept });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ status: 'error', message: 'A department with this name already exists' });
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.put('/api/departments/:id', async (req, res) => {
    try {
        const { name, code, head, status, location, operatingHours, email, phone, headEmail, extension, totalBeds, bedsAvailable, totalRooms, nursesCount, techniciansCount, adminStaffCount, staffCount, services, equipment, description } = req.body;
        const department = await Department.findById(req.params.id);
        if (!department) return res.status(404).json({ status: 'error', message: 'Department not found' });
        if (name && name.trim() !== department.name) {
            const existing = await Department.findOne({ name: name.trim() });
            if (existing) return res.status(400).json({ status: 'error', message: 'A department with this name already exists' });
        }
        department.name = name !== undefined ? name.trim() : department.name;
        department.code = code !== undefined ? code.trim().toUpperCase() : department.code;
        department.head = head !== undefined ? head.trim() : department.head;
        if (status !== undefined) department.status = status;
        if (location !== undefined) department.location = location;
        if (operatingHours !== undefined) department.operatingHours = operatingHours;
        if (email !== undefined) department.email = email;
        if (phone !== undefined) department.phone = phone;
        if (headEmail !== undefined) department.headEmail = headEmail;
        if (extension !== undefined) department.extension = extension;
        if (totalBeds !== undefined && totalBeds !== null) department.totalBeds = totalBeds;
        if (bedsAvailable !== undefined && bedsAvailable !== null) department.bedsAvailable = bedsAvailable;
        if (totalRooms !== undefined && totalRooms !== null) department.totalRooms = totalRooms;
        if (nursesCount !== undefined && nursesCount !== null) department.nursesCount = nursesCount;
        if (techniciansCount !== undefined && techniciansCount !== null) department.techniciansCount = techniciansCount;
        if (adminStaffCount !== undefined && adminStaffCount !== null) department.adminStaffCount = adminStaffCount;
        if (staffCount !== undefined && staffCount !== null) department.staffCount = staffCount;
        if (services !== undefined) department.services = services;
        if (equipment !== undefined) department.equipment = equipment;
        if (description !== undefined) department.description = description;
        department.doctorsCount = await Doctor.countDocuments({ department: { $regex: new RegExp(`^${department.name.trim()}$`, 'i') } });
        await department.save();
        res.status(200).json({ status: 'success', data: department });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.delete('/api/departments/:id', async (req, res) => {
    try {
        const department = await Department.findByIdAndDelete(req.params.id);
        if (!department) return res.status(404).json({ status: 'error', message: 'Department not found' });
        res.status(200).json({ status: 'success', message: 'Department deleted successfully' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to delete department' });
    }
});

// ============ PATIENT ROUTES ============
app.get('/api/patients', async (req, res) => {
    try {
        const patients = await Patient.find().sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: patients });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch patients' });
    }
});

app.get('/api/patients/:id', async (req, res) => {
    try {
        const patient = await Patient.findById(req.params.id);
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found' });
        res.status(200).json({ status: 'success', data: patient });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch patient' });
    }
});

app.post('/api/patients', async (req, res) => {
    try {
        const { firstName, lastName, dateOfBirth, gender, email, phone, bloodGroup, status, address, medicalCondition, allergies, emergencyContact } = req.body;
        if (!firstName || !lastName || !dateOfBirth || !gender || !email || !phone) {
            return res.status(400).json({ status: 'error', message: 'All required fields must be filled' });
        }
        const existingPatient = await Patient.findOne({ email });
        if (existingPatient) return res.status(400).json({ status: 'error', message: 'A patient with this email already exists' });
        const newPatient = await Patient.create({
            firstName, lastName, dateOfBirth, gender, email, phone,
            bloodGroup: bloodGroup || null, status: status || 'Active',
            address: address || '', medicalCondition: medicalCondition || '',
            allergies: allergies || '', emergencyContact: emergencyContact || ''
        });
        res.status(201).json({ status: 'success', data: newPatient });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ status: 'error', message: 'A patient with this email already exists' });
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.put('/api/patients/:id', async (req, res) => {
    try {
        const { firstName, lastName, dateOfBirth, gender, email, phone, bloodGroup, status, address, medicalCondition, allergies, emergencyContact } = req.body;
        const patient = await Patient.findById(req.params.id);
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found' });
        if (email && email !== patient.email) {
            const existingPatient = await Patient.findOne({ email });
            if (existingPatient) return res.status(400).json({ status: 'error', message: 'A patient with this email already exists' });
        }
        patient.firstName = firstName || patient.firstName;
        patient.lastName = lastName || patient.lastName;
        patient.dateOfBirth = dateOfBirth || patient.dateOfBirth;
        patient.gender = gender || patient.gender;
        patient.email = email || patient.email;
        patient.phone = phone || patient.phone;
        if (bloodGroup !== undefined) patient.bloodGroup = bloodGroup;
        if (status !== undefined) patient.status = status;
        if (address !== undefined) patient.address = address;
        if (medicalCondition !== undefined) patient.medicalCondition = medicalCondition;
        if (allergies !== undefined) patient.allergies = allergies;
        if (emergencyContact !== undefined) patient.emergencyContact = emergencyContact;
        patient.autoCreated = false;
        await patient.save();
        res.status(200).json({ status: 'success', data: patient });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.delete('/api/patients/:id', async (req, res) => {
    try {
        const patient = await Patient.findById(req.params.id);
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found' });

        console.log(`🗑️  Deleting patient: ${patient.email} (${patient.firstName} ${patient.lastName})`);

        const userDeleted = await cascadeDeleteUser({
            linkedUserId: patient.linkedUserId,
            email: patient.email,
            role: 'patient'
        });

        await Patient.findByIdAndDelete(req.params.id);

        res.status(200).json({
            status: 'success',
            message: userDeleted
                ? 'Patient and linked user account deleted. They can sign up again.'
                : 'Patient profile deleted. (No linked user account was found.)',
            data: { userDeleted }
        });
    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete patient' });
    }
});

app.post('/api/patients/sync', async (req, res) => {
    try {
        const patientUsers = await User.find({ role: 'patient' });
        const results = { created: 0, alreadyExists: 0, errors: [] };
        for (const user of patientUsers) {
            try {
                const existing = await Patient.findOne({ $or: [{ email: user.email }, { linkedUserId: user._id }] });
                if (existing) { results.alreadyExists++; continue; }
                const created = await ensurePatientProfile(user);
                if (created) results.created++;
                else results.errors.push({ email: user.email, error: 'Failed to create' });
            } catch (err) {
                results.errors.push({ email: user.email, error: err.message });
            }
        }
        console.log(`🔄 Patient sync complete: ${results.created} created, ${results.alreadyExists} already existed`);
        res.status(200).json({ status: 'success', message: 'Patient profiles synced', data: results });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to sync patient profiles' });
    }
});

// ============================================================
// ⭐ NEW: APPOINTMENT ROUTES
// ============================================================

// Get stats (must be BEFORE /:id)
app.get('/api/appointments/stats', async (req, res) => {
    try {
        const total = await Appointment.countDocuments();
        const today = new Date().toISOString().slice(0, 10);
        const todayCount = await Appointment.countDocuments({ date: today });
        const scheduled = await Appointment.countDocuments({ status: 'scheduled' });
        const pending = await Appointment.countDocuments({ status: 'pending' });
        const completed = await Appointment.countDocuments({ status: 'completed' });
        const cancelled = await Appointment.countDocuments({ status: 'cancelled' });

        res.status(200).json({
            status: 'success',
            data: { total, today: todayCount, scheduled, pending, completed, cancelled }
        });
    } catch (error) {
        console.error('Appointment stats error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to compute stats' });
    }
});

// List all
app.get('/api/appointments', async (req, res) => {
    try {
        const query = {};
        if (req.query.status && req.query.status !== 'all') query.status = req.query.status;
        if (req.query.doctor && req.query.doctor !== 'all') query.doctor = req.query.doctor;
        if (req.query.department && req.query.department !== 'all') query.department = req.query.department;
        if (req.query.date) query.date = req.query.date;

        const appointments = await Appointment.find(query).sort({ date: 1, time: 1 });
        res.status(200).json({ status: 'success', data: appointments });
    } catch (error) {
        console.error('Fetch appointments error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch appointments' });
    }
});

// Get one
app.get('/api/appointments/:id', async (req, res) => {
    try {
        const a = await Appointment.findById(req.params.id);
        if (!a) return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        res.status(200).json({ status: 'success', data: a });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch appointment' });
    }
});

// Create
app.post('/api/appointments', async (req, res) => {
    try {
        const { patientName, patientId, date, time, doctor, department, status, notes } = req.body;

        if (!patientName || !date || !time || !doctor || !department) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: patientName, date, time, doctor, department'
            });
        }

        const a = await Appointment.create({
            patientName,
            patientId: patientId || '',
            date,
            time,
            doctor,
            department,
            status: status || 'scheduled',
            notes: notes || ''
        });

        console.log(`✅ Appointment created: ${patientName} with ${doctor} on ${date} ${time}`);
        res.status(201).json({ status: 'success', data: a });
    } catch (error) {
        console.error('Create appointment error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// Update
app.put('/api/appointments/:id', async (req, res) => {
    try {
        const a = await Appointment.findById(req.params.id);
        if (!a) return res.status(404).json({ status: 'error', message: 'Appointment not found' });

        const fields = ['patientName', 'patientId', 'date', 'time', 'doctor', 'department', 'status', 'notes'];
        fields.forEach(f => {
            if (req.body[f] !== undefined) a[f] = req.body[f];
        });

        await a.save();
        res.status(200).json({ status: 'success', data: a });
    } catch (error) {
        console.error('Update appointment error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// Delete
app.delete('/api/appointments/:id', async (req, res) => {
    try {
        const a = await Appointment.findByIdAndDelete(req.params.id);
        if (!a) return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        console.log(`🗑️  Appointment deleted: ${a.patientName} with ${a.doctor}`);
        res.status(200).json({ status: 'success', message: 'Appointment deleted' });
    } catch (error) {
        console.error('Delete appointment error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete appointment' });
    }
});

// ============ PHARMACY ROUTES ============
function recomputeMedicationFromBatches(med) {
    if (!Array.isArray(med.batches)) return;
    const totalQty = med.batches.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0);
    med.quantity = totalQty;
    const futureBatches = med.batches.filter(b => (parseInt(b.quantity) || 0) > 0);
    if (futureBatches.length > 0) {
        const soonest = futureBatches.reduce((min, b) => {
            const d = new Date(b.expiryDate);
            return (!min || d < min) ? d : min;
        }, null);
        if (soonest) med.expiryDate = soonest;
    }
}

app.get('/api/pharmacy', async (req, res) => {
    try {
        const medications = await Medication.find().sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: medications });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch medications' });
    }
});

app.get('/api/pharmacy/:id', async (req, res) => {
    try {
        const medication = await Medication.findById(req.params.id);
        if (!medication) return res.status(404).json({ status: 'error', message: 'Medication not found' });
        res.status(200).json({ status: 'success', data: medication });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch medication' });
    }
});

app.get('/api/pharmacy/:id/history', async (req, res) => {
    try {
        const medication = await Medication.findById(req.params.id);
        if (!medication) return res.status(404).json({ status: 'error', message: 'Medication not found' });
        const logs = await StockLog.find({ medicationId: req.params.id }).sort({ createdAt: -1 }).limit(200);
        const dispenses = await DispenseLog.find({ medicationId: req.params.id }).sort({ createdAt: -1 }).limit(200);
        res.status(200).json({ status: 'success', data: { logs, dispenses } });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch history' });
    }
});

app.post('/api/pharmacy', async (req, res) => {
    try {
        const { name, category, manufacturer, strength, quantity, price, expiryDate, minStock, description, batches, actorEmail } = req.body;
        if (!name || !category || !manufacturer || !strength || quantity === undefined || price === undefined || !expiryDate) {
            return res.status(400).json({ status: 'error', message: 'All required fields must be filled' });
        }
        const existingMedication = await Medication.findOne({ name: name.trim(), strength: strength.trim() });
        if (existingMedication) return res.status(400).json({ status: 'error', message: 'A medication with this name and strength already exists' });

        let batchesData = [];
        if (Array.isArray(batches) && batches.length > 0) {
            batchesData = batches;
        } else {
            batchesData = [{
                batchNumber: '',
                quantity: parseInt(quantity) || 0,
                expiryDate: new Date(expiryDate),
                receivedDate: new Date(),
                supplier: ''
            }];
        }

        const newMedication = await Medication.create({
            name: name.trim(),
            category: category.trim(),
            manufacturer: manufacturer.trim(),
            strength: strength.trim(),
            quantity: batchesData.reduce((s, b) => s + (parseInt(b.quantity) || 0), 0),
            price: parseFloat(price) || 0,
            expiryDate: new Date(expiryDate),
            minStock: minStock !== undefined && minStock !== null ? minStock : 10,
            description: description || '',
            batches: batchesData
        });

        await writeStockLog({
            medicationId: newMedication._id,
            medicationName: newMedication.name,
            action: 'create',
            previousQty: 0,
            newQty: newMedication.quantity,
            note: 'Medication created',
            actorEmail: actorEmail || ''
        });

        res.status(201).json({ status: 'success', data: newMedication });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ status: 'error', message: 'A medication with this name already exists' });
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.put('/api/pharmacy/:id', async (req, res) => {
    try {
        const { name, category, manufacturer, strength, quantity, price, expiryDate, minStock, description, actorEmail } = req.body;
        const medication = await Medication.findById(req.params.id);
        if (!medication) return res.status(404).json({ status: 'error', message: 'Medication not found' });

        if (name && name.trim() !== medication.name) {
            const existingMedication = await Medication.findOne({ name: name.trim(), strength: (strength || medication.strength).trim() });
            if (existingMedication) return res.status(400).json({ status: 'error', message: 'A medication with this name and strength already exists' });
        }

        const previousQty = medication.quantity;

        medication.name = name ? name.trim() : medication.name;
        medication.category = category ? category.trim() : medication.category;
        medication.manufacturer = manufacturer ? manufacturer.trim() : medication.manufacturer;
        medication.strength = strength ? strength.trim() : medication.strength;
        medication.price = price !== undefined ? parseFloat(price) || 0 : medication.price;
        medication.minStock = minStock !== undefined && minStock !== null ? minStock : medication.minStock;
        medication.description = description !== undefined ? description : medication.description;

        if (quantity !== undefined && quantity !== null) {
            const newQty = parseInt(quantity) || 0;
            if (!Array.isArray(medication.batches) || medication.batches.length === 0) {
                medication.batches = [{
                    batchNumber: 'ADJUST',
                    quantity: newQty,
                    expiryDate: expiryDate ? new Date(expiryDate) : medication.expiryDate,
                    receivedDate: new Date(),
                    supplier: ''
                }];
            } else {
                const totalOther = medication.batches.slice(1).reduce((s, b) => s + (parseInt(b.quantity) || 0), 0);
                const adjust = Math.max(0, newQty - totalOther);
                medication.batches[0].quantity = adjust;
                if (expiryDate) medication.batches[0].expiryDate = new Date(expiryDate);
            }
            recomputeMedicationFromBatches(medication);
        }

        if (expiryDate) {
            medication.expiryDate = new Date(expiryDate);
        }

        await medication.save();

        await writeStockLog({
            medicationId: medication._id,
            medicationName: medication.name,
            action: 'edit',
            previousQty,
            newQty: medication.quantity,
            note: 'Medication details updated',
            actorEmail: actorEmail || ''
        });

        if (medication.quantity <= medication.minStock && previousQty > medication.minStock) {
            sendLowStockAlertEmail(medication, medication.quantity).catch(e => console.error(e));
        }

        res.status(200).json({ status: 'success', data: medication });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.patch('/api/pharmacy/:id/stock', async (req, res) => {
    try {
        const { quantity, note, batchNumber, expiryDate, supplier, actorEmail } = req.body;
        if (quantity === undefined || quantity < 0) return res.status(400).json({ status: 'error', message: 'Valid quantity is required' });

        const medication = await Medication.findById(req.params.id);
        if (!medication) return res.status(404).json({ status: 'error', message: 'Medication not found' });

        const previousQty = medication.quantity;
        const addAmount = parseInt(quantity) || 0;

        if (batchNumber || expiryDate) {
            medication.batches.push({
                batchNumber: batchNumber || '',
                quantity: addAmount,
                expiryDate: expiryDate ? new Date(expiryDate) : medication.expiryDate,
                receivedDate: new Date(),
                supplier: supplier || ''
            });
        } else if (Array.isArray(medication.batches) && medication.batches.length > 0) {
            medication.batches[0].quantity = (parseInt(medication.batches[0].quantity) || 0) + addAmount;
        } else {
            medication.batches = [{
                batchNumber: '',
                quantity: addAmount,
                expiryDate: medication.expiryDate,
                receivedDate: new Date(),
                supplier: supplier || ''
            }];
        }

        recomputeMedicationFromBatches(medication);
        await medication.save();

        await writeStockLog({
            medicationId: medication._id,
            medicationName: medication.name,
            action: 'restock',
            previousQty,
            newQty: medication.quantity,
            note: note || `Restocked +${addAmount}`,
            actorEmail: actorEmail || ''
        });

        res.status(200).json({ status: 'success', data: medication, message: 'Stock updated successfully' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to update stock' });
    }
});

app.post('/api/pharmacy/:id/dispense', async (req, res) => {
    try {
        const { quantity, patientId, patientName, note, actorEmail } = req.body;
        const dispQty = parseInt(quantity);
        if (!dispQty || dispQty <= 0) return res.status(400).json({ status: 'error', message: 'Valid quantity is required' });

        const medication = await Medication.findById(req.params.id);
        if (!medication) return res.status(404).json({ status: 'error', message: 'Medication not found' });

        if (medication.quantity < dispQty) {
            return res.status(400).json({ status: 'error', message: `Not enough stock (available: ${medication.quantity})` });
        }

        const previousQty = medication.quantity;
        let remaining = dispQty;

        const sortedBatches = [...medication.batches].sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
        medication.batches = sortedBatches;

        for (const batch of medication.batches) {
            if (remaining <= 0) break;
            const avail = parseInt(batch.quantity) || 0;
            if (avail <= 0) continue;
            const take = Math.min(avail, remaining);
            batch.quantity = avail - take;
            remaining -= take;
        }

        medication.batches = medication.batches.filter(b => (parseInt(b.quantity) || 0) > 0);

        recomputeMedicationFromBatches(medication);
        await medication.save();

        await DispenseLog.create({
            medicationId: medication._id,
            medicationName: medication.name,
            patientId: patientId || null,
            patientName: patientName || '',
            quantity: dispQty,
            note: note || '',
            actorEmail: actorEmail || ''
        });

        await writeStockLog({
            medicationId: medication._id,
            medicationName: medication.name,
            action: 'dispense',
            previousQty,
            newQty: medication.quantity,
            note: patientName ? `Dispensed to ${patientName}` : 'Dispensed',
            actorEmail: actorEmail || ''
        });

        if (medication.quantity <= medication.minStock && previousQty > medication.minStock) {
            sendLowStockAlertEmail(medication, medication.quantity).catch(e => console.error(e));
        }

        res.status(200).json({ status: 'success', data: medication, message: `Dispensed ${dispQty} unit(s)` });
    } catch (error) {
        console.error('Dispense error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to dispense medication' });
    }
});

app.delete('/api/pharmacy/:id', async (req, res) => {
    try {
        const medication = await Medication.findByIdAndDelete(req.params.id);
        if (!medication) return res.status(404).json({ status: 'error', message: 'Medication not found' });
        await writeStockLog({
            medicationId: medication._id,
            medicationName: medication.name,
            action: 'delete',
            previousQty: medication.quantity,
            newQty: 0,
            note: 'Medication deleted',
            actorEmail: req.body?.actorEmail || ''
        });
        res.status(200).json({ status: 'success', message: 'Medication deleted successfully' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to delete medication' });
    }
});

app.post('/api/pharmacy/bulk-import', async (req, res) => {
    try {
        const { items, actorEmail } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No items provided' });
        }

        const results = { created: 0, skipped: 0, errors: [] };

        for (const raw of items) {
            try {
                const { name, strength, category, manufacturer, quantity, price, expiryDate, minStock, description } = raw;
                if (!name || !strength || !category || !manufacturer || !expiryDate) {
                    results.errors.push({ item: raw, error: 'Missing required fields' });
                    continue;
                }
                const existing = await Medication.findOne({ name: name.trim(), strength: strength.trim() });
                if (existing) {
                    results.skipped++;
                    continue;
                }
                const newMed = await Medication.create({
                    name: name.trim(),
                    strength: strength.trim(),
                    category: category.trim(),
                    manufacturer: manufacturer.trim(),
                    quantity: parseInt(quantity) || 0,
                    price: parseFloat(price) || 0,
                    expiryDate: new Date(expiryDate),
                    minStock: minStock !== undefined ? parseInt(minStock) : 10,
                    description: description || '',
                    batches: [{
                        batchNumber: '',
                        quantity: parseInt(quantity) || 0,
                        expiryDate: new Date(expiryDate),
                        receivedDate: new Date(),
                        supplier: ''
                    }]
                });
                await writeStockLog({
                    medicationId: newMed._id,
                    medicationName: newMed.name,
                    action: 'bulk-import',
                    previousQty: 0,
                    newQty: newMed.quantity,
                    note: 'Imported in bulk',
                    actorEmail: actorEmail || ''
                });
                results.created++;
            } catch (err) {
                results.errors.push({ item: raw, error: err.message });
            }
        }

        res.status(200).json({ status: 'success', data: results });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Bulk import failed' });
    }
});

// ============ VITALS ROUTES ============
app.get('/api/vitals', async (req, res) => {
    try {
        const query = {};
        if (req.query.patientId) query.patientId = req.query.patientId;
        const vitals = await Vital.find(query).sort({ recordedAt: -1 }).limit(500);
        res.status(200).json({ status: 'success', data: vitals });
    } catch (error) {
        console.error('Get vitals error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch vitals' });
    }
});

app.get('/api/vitals/:id', async (req, res) => {
    try {
        const vital = await Vital.findById(req.params.id);
        if (!vital) return res.status(404).json({ status: 'error', message: 'Vital not found' });
        res.status(200).json({ status: 'success', data: vital });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch vital' });
    }
});

app.post('/api/vitals', async (req, res) => {
    try {
        const {
            patientId, patientName,
            heartRate, systolic, diastolic, hrv, spo2, temperature, respiratoryRate, bloodGlucose,
            note, recordedBy, recordedAt
        } = req.body;

        if (!patientId) {
            return res.status(400).json({ status: 'error', message: 'Patient is required' });
        }

        const hasAnyReading = [heartRate, systolic, diastolic, hrv, spo2, temperature, respiratoryRate, bloodGlucose]
            .some(v => v !== null && v !== undefined && v !== '');
        if (!hasAnyReading) {
            return res.status(400).json({ status: 'error', message: 'At least one vital reading is required' });
        }

        const newVital = await Vital.create({
            patientId,
            patientName: patientName || '',
            heartRate: heartRate !== '' && heartRate !== undefined && heartRate !== null ? Number(heartRate) : null,
            systolic: systolic !== '' && systolic !== undefined && systolic !== null ? Number(systolic) : null,
            diastolic: diastolic !== '' && diastolic !== undefined && diastolic !== null ? Number(diastolic) : null,
            hrv: hrv !== '' && hrv !== undefined && hrv !== null ? Number(hrv) : null,
            spo2: spo2 !== '' && spo2 !== undefined && spo2 !== null ? Number(spo2) : null,
            temperature: temperature !== '' && temperature !== undefined && temperature !== null ? Number(temperature) : null,
            respiratoryRate: respiratoryRate !== '' && respiratoryRate !== undefined && respiratoryRate !== null ? Number(respiratoryRate) : null,
            bloodGlucose: bloodGlucose !== '' && bloodGlucose !== undefined && bloodGlucose !== null ? Number(bloodGlucose) : null,
            note: note || '',
            recordedBy: recordedBy || '',
            recordedAt: recordedAt ? new Date(recordedAt) : new Date()
        });

        res.status(201).json({ status: 'success', data: newVital });
    } catch (error) {
        console.error('Create vital error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.put('/api/vitals/:id', async (req, res) => {
    try {
        const {
            heartRate, systolic, diastolic, hrv, spo2, temperature, respiratoryRate, bloodGlucose,
            note, recordedBy, recordedAt
        } = req.body;

        const vital = await Vital.findById(req.params.id);
        if (!vital) return res.status(404).json({ status: 'error', message: 'Vital not found' });

        if (heartRate !== undefined) vital.heartRate = heartRate === '' || heartRate === null ? null : Number(heartRate);
        if (systolic !== undefined) vital.systolic = systolic === '' || systolic === null ? null : Number(systolic);
        if (diastolic !== undefined) vital.diastolic = diastolic === '' || diastolic === null ? null : Number(diastolic);
        if (hrv !== undefined) vital.hrv = hrv === '' || hrv === null ? null : Number(hrv);
        if (spo2 !== undefined) vital.spo2 = spo2 === '' || spo2 === null ? null : Number(spo2);
        if (temperature !== undefined) vital.temperature = temperature === '' || temperature === null ? null : Number(temperature);
        if (respiratoryRate !== undefined) vital.respiratoryRate = respiratoryRate === '' || respiratoryRate === null ? null : Number(respiratoryRate);
        if (bloodGlucose !== undefined) vital.bloodGlucose = bloodGlucose === '' || bloodGlucose === null ? null : Number(bloodGlucose);
        if (note !== undefined) vital.note = note;
        if (recordedBy !== undefined) vital.recordedBy = recordedBy;
        if (recordedAt !== undefined) vital.recordedAt = new Date(recordedAt);

        await vital.save();
        res.status(200).json({ status: 'success', data: vital });
    } catch (error) {
        console.error('Update vital error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.delete('/api/vitals/:id', async (req, res) => {
    try {
        const vital = await Vital.findByIdAndDelete(req.params.id);
        if (!vital) return res.status(404).json({ status: 'error', message: 'Vital not found' });
        res.status(200).json({ status: 'success', message: 'Vital reading deleted' });
    } catch (error) {
        console.error('Delete vital error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete vital' });
    }
});

app.get('/api/vitals/stats/:patientId', async (req, res) => {
    try {
        const { patientId } = req.params;
        const days = parseInt(req.query.days) || 7;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const vitals = await Vital.find({
            patientId,
            recordedAt: { $gte: since }
        }).sort({ recordedAt: 1 });

        const avg = (key) => {
            const vals = vitals.map(v => v[key]).filter(v => typeof v === 'number' && !isNaN(v));
            if (!vals.length) return null;
            return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
        };
        const min = (key) => {
            const vals = vitals.map(v => v[key]).filter(v => typeof v === 'number' && !isNaN(v));
            return vals.length ? Math.min(...vals) : null;
        };
        const max = (key) => {
            const vals = vitals.map(v => v[key]).filter(v => typeof v === 'number' && !isNaN(v));
            return vals.length ? Math.max(...vals) : null;
        };

        res.status(200).json({
            status: 'success',
            data: {
                days,
                count: vitals.length,
                heartRate: { avg: avg('heartRate'), min: min('heartRate'), max: max('heartRate') },
                systolic: { avg: avg('systolic'), min: min('systolic'), max: max('systolic') },
                diastolic: { avg: avg('diastolic'), min: min('diastolic'), max: max('diastolic') },
                hrv: { avg: avg('hrv'), min: min('hrv'), max: max('hrv') },
                spo2: { avg: avg('spo2'), min: min('spo2'), max: max('spo2') },
                temperature: { avg: avg('temperature'), min: min('temperature'), max: max('temperature') },
                respiratoryRate: { avg: avg('respiratoryRate'), min: min('respiratoryRate'), max: max('respiratoryRate') },
                bloodGlucose: { avg: avg('bloodGlucose'), min: min('bloodGlucose'), max: max('bloodGlucose') }
            }
        });
    } catch (error) {
        console.error('Vitals stats error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to compute stats' });
    }
});

// ============ PUBLIC VITALS ROUTES ============
app.post('/api/public/vitals', async (req, res) => {
    try {
        const {
            displayName, ageRange, gender, source,
            heartRate, systolic, diastolic, hrv, spo2, temperature, respiratoryRate, bloodGlucose
        } = req.body || {};

        const clean = {
            displayName: displayName || '',
            ageRange: ageRange || '',
            gender: gender || '',
            source: ['manual', 'camera-scan', 'bluetooth-device'].includes(source) ? source : 'manual',
            heartRate: heartRate === '' || heartRate == null ? null : Number(heartRate),
            systolic: systolic === '' || systolic == null ? null : Number(systolic),
            diastolic: diastolic === '' || diastolic == null ? null : Number(diastolic),
            hrv: hrv === '' || hrv == null ? null : Number(hrv),
            spo2: spo2 === '' || spo2 == null ? null : Number(spo2),
            temperature: temperature === '' || temperature == null ? null : Number(temperature),
            respiratoryRate: respiratoryRate === '' || respiratoryRate == null ? null : Number(respiratoryRate),
            bloodGlucose: bloodGlucose === '' || bloodGlucose == null ? null : Number(bloodGlucose)
        };

        const hasAny = Object.values(clean).some(v => typeof v === 'number' && !isNaN(v));
        if (!hasAny) {
            return res.status(400).json({ status: 'error', message: 'Please enter at least one reading' });
        }

        const outOfRange = [];
        if (clean.heartRate != null && (clean.heartRate < 0 || clean.heartRate > 300)) outOfRange.push('heartRate');
        if (clean.systolic != null && (clean.systolic < 0 || clean.systolic > 300)) outOfRange.push('systolic');
        if (clean.diastolic != null && (clean.diastolic < 0 || clean.diastolic > 200)) outOfRange.push('diastolic');
        if (clean.spo2 != null && (clean.spo2 < 0 || clean.spo2 > 100)) outOfRange.push('spo2');
        if (clean.temperature != null && (clean.temperature < 20 || clean.temperature > 45)) outOfRange.push('temperature');
        if (outOfRange.length) {
            return res.status(400).json({ status: 'error', message: `Value out of range: ${outOfRange.join(', ')}` });
        }

        const analysis = analyzeVitals(clean);

        const saved = await PublicVital.create({
            ...clean,
            overallLevel: analysis.overallLevel,
            flags: analysis.flags,
            userAgent: (req.headers['user-agent'] || '').slice(0, 300),
            recordedAt: new Date()
        });

        res.status(201).json({
            status: 'success',
            data: {
                id: saved._id,
                recordedAt: saved.recordedAt,
                overallLevel: analysis.overallLevel,
                flags: analysis.flags,
                breakdown: analysis.breakdown
            }
        });
    } catch (error) {
        console.error('Public vitals error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.post('/api/public/vitals/analyze', (req, res) => {
    try {
        const input = req.body || {};
        const clean = {
            heartRate: input.heartRate === '' || input.heartRate == null ? null : Number(input.heartRate),
            systolic: input.systolic === '' || input.systolic == null ? null : Number(input.systolic),
            diastolic: input.diastolic === '' || input.diastolic == null ? null : Number(input.diastolic),
            hrv: input.hrv === '' || input.hrv == null ? null : Number(input.hrv),
            spo2: input.spo2 === '' || input.spo2 == null ? null : Number(input.spo2),
            temperature: input.temperature === '' || input.temperature == null ? null : Number(input.temperature),
            respiratoryRate: input.respiratoryRate === '' || input.respiratoryRate == null ? null : Number(input.respiratoryRate),
            bloodGlucose: input.bloodGlucose === '' || input.bloodGlucose == null ? null : Number(input.bloodGlucose)
        };
        const analysis = analyzeVitals(clean);
        res.status(200).json({ status: 'success', data: analysis });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

app.get('/api/public/vitals/recent', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const recent = await PublicVital.find({}, {
            displayName: 1, overallLevel: 1, recordedAt: 1, source: 1, _id: 0
        }).sort({ recordedAt: -1 }).limit(limit);
        res.status(200).json({ status: 'success', data: recent });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to load recent readings' });
    }
});

app.post('/api/public/vitals/from-device', async (req, res) => {
    try {
        const {
            deviceId, displayName, ageRange, gender,
            heartRate, spo2, temperature, systolic, diastolic
        } = req.body || {};

        const clean = {
            displayName: displayName || '',
            ageRange: ageRange || '',
            gender: gender || '',
            source: 'bluetooth-device',
            heartRate: heartRate == null ? null : Number(heartRate),
            spo2: spo2 == null ? null : Number(spo2),
            temperature: temperature == null ? null : Number(temperature),
            systolic: systolic == null ? null : Number(systolic),
            diastolic: diastolic == null ? null : Number(diastolic),
            hrv: null,
            respiratoryRate: null,
            bloodGlucose: null
        };

        const hasAny = Object.values(clean).some(v => typeof v === 'number' && !isNaN(v));
        if (!hasAny) return res.status(400).json({ status: 'error', message: 'No readings provided' });

        const analysis = analyzeVitals(clean);
        const saved = await PublicVital.create({
            ...clean,
            overallLevel: analysis.overallLevel,
            flags: analysis.flags,
            userAgent: (req.headers['user-agent'] || '').slice(0, 300) + ' [bt-device]',
            recordedAt: new Date()
        });

        res.status(201).json({
            status: 'success',
            data: {
                id: saved._id,
                recordedAt: saved.recordedAt,
                overallLevel: analysis.overallLevel,
                flags: analysis.flags,
                breakdown: analysis.breakdown
            }
        });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// ============ BP CALIBRATION ROUTES ============
app.get('/api/public/vitals/calibration/:deviceId', async (req, res) => {
    try {
        const cal = await BpCalibration.findOne({ deviceId: req.params.deviceId });
        if (!cal) return res.status(404).json({ status: 'error', message: 'No calibration found' });
        res.status(200).json({ status: 'success', data: cal });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to fetch calibration' });
    }
});

app.post('/api/public/vitals/calibration', async (req, res) => {
    try {
        const { deviceId, systolic, diastolic, pulseAtCalibration } = req.body;
        if (!deviceId || !systolic || !diastolic) {
            return res.status(400).json({ status: 'error', message: 'deviceId, systolic, diastolic are required' });
        }
        const sys = Number(systolic);
        const dia = Number(diastolic);
        if (isNaN(sys) || isNaN(dia) || sys < 60 || sys > 260 || dia < 40 || dia > 180) {
            return res.status(400).json({ status: 'error', message: 'Values are out of range' });
        }
        const cal = await BpCalibration.findOneAndUpdate(
            { deviceId },
            {
                deviceId,
                systolic: sys,
                diastolic: dia,
                pulseAtCalibration: pulseAtCalibration ? Number(pulseAtCalibration) : null,
                calibrationDate: new Date(),
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        res.status(200).json({ status: 'success', data: cal });
    } catch (error) {
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// ============ DEBUG ROUTES ============
app.get('/api/debug/users', async (req, res) => {
    try {
        const users = await User.find({});
        res.json({ status: 'success', data: users });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/api/debug/check-password', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).select('+password');
        if (!user) return res.json({ status: 'error', message: 'User not found', userExists: false });
        const isMatch = await user.correctPassword(password);
        res.json({
            status: 'success',
            data: { email: user.email, passwordMatch: isMatch, userExists: true }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/api/debug/sync-status', async (req, res) => {
    try {
        const users = await User.find({});
        const report = [];
        for (const u of users) {
            const entry = {
                email: u.email,
                name: u.name,
                role: u.role,
                hasDoctorProfile: false,
                hasPatientProfile: false,
                hasPharmacistProfile: false
            };
            if (u.role === 'doctor') {
                entry.hasDoctorProfile = !!(await Doctor.findOne({ $or: [{ email: u.email }, { linkedUserId: u._id }] }));
            } else if (u.role === 'patient') {
                entry.hasPatientProfile = !!(await Patient.findOne({ $or: [{ email: u.email }, { linkedUserId: u._id }] }));
            } else if (u.role === 'pharmacist') {
                entry.hasPharmacistProfile = !!(await Pharmacist.findOne({ $or: [{ email: u.email }, { linkedUserId: u._id }] }));
            }
            report.push(entry);
        }
        res.json({ status: 'success', data: report });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ⭐ NEW: Debug for appointments
app.get('/api/debug/appointments-count', async (req, res) => {
    try {
        const count = await Appointment.countDocuments();
        res.json({ status: 'success', count });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ status: 'error', message: 'Something went wrong!' });
});

app.use('*', (req, res) => {
    res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Google Client ID loaded: ${process.env.GOOGLE_CLIENT_ID ? '✓' : '✗ (missing in .env)'}`);
        console.log(`Landing page (Dashboard): http://localhost:${PORT}/`);
        console.log(`Dashboard:     http://localhost:${PORT}/dashboard.html`);
        console.log(`Login:         http://localhost:${PORT}/loginpg.html`);
        console.log(`Doctors:       http://localhost:${PORT}/doctors.html`);
        console.log(`Departments:   http://localhost:${PORT}/departments.html`);
        console.log(`Patients:      http://localhost:${PORT}/patients.html`);
        console.log(`Appointments:  http://localhost:${PORT}/appointment.html`);
        console.log(`Pharmacy:      http://localhost:${PORT}/pharmacy.html`);
       
        console.log(`Vitals Scan:   http://localhost:${PORT}/vitals-scan.html`);
    });
};

startServer();