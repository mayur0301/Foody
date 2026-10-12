const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Room = require('../models/Room');

exports.generateReceiptPdf = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate('user', 'profile.name phone username')   // consistent fields with orders
      .populate('room', 'number type price');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Authorization: same logic as in order bill
    const isOwner = booking.user._id.toString() === req.user.id;
    const isStaff = ['admin', 'staff'].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: 'Not authorized to download this receipt' });
    }

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `receipt-${booking._id}.pdf`;

    // Stream directly to client - consistent with order bill
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    doc.pipe(res);

    // ────────────────────────────────────────────────
    // Header (aligned with order bill style)
    // ────────────────────────────────────────────────
    doc.fontSize(20).text('Hotel Accommodation Receipt', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Receipt ID: ${booking._id}`, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();

    // Guest & Booking Info
    doc.fontSize(12);
    doc.text(`Guest: ${booking.user.profile?.name || booking.user.username || 'Guest'}`);
    doc.text(`Phone: ${booking.user.phone || 'N/A'}`);
    doc.text(`Room: ${booking.room?.number || 'N/A'} (${booking.room?.type || 'N/A'})`);
    doc.moveDown(0.5);

    doc.text(`Check-in:  ${new Date(booking.checkIn).toLocaleDateString()}`);
    doc.text(`Check-out: ${new Date(booking.checkOut).toLocaleDateString()}`);
    doc.text(`Status:   ${booking.status.toUpperCase()}`);
    doc.moveDown(1);

    // Amount section (simple & right-aligned like order bill)
    doc.fontSize(14).text('Total Amount', { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(12).text(
      `Accommodation: $${(booking.totalPrice || 0).toFixed(2)}`,
      { align: 'right' }
    );

    // Optional: show breakdown if your Booking model has it
    // (uncomment/adjust if you store basePrice, tax, etc. separately)
    // doc.text(`Base Price: $${(booking.basePrice || 0).toFixed(2)}`, { align: 'right' });
    // if (booking.tax) {
    //   doc.text(`Tax: $${booking.tax.toFixed(2)}`, { align: 'right' });
    // }

    doc.moveDown(0.5);
    doc.fontSize(14).text(
      `Grand Total: $${(booking.totalPrice || 0).toFixed(2)}`,
      { align: 'right', underline: true }
    );

    doc.end();

    // Optional: you could update booking status here if needed
    // e.g. mark as receipt-generated, but usually not necessary

  } catch (err) {
    console.error('Receipt generation error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error generating receipt' });
    }
  }
};