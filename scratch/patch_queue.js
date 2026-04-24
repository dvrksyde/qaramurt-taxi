const fs = require('fs');
let code = fs.readFileSync('driver-app/app/index.tsx', 'utf8');

// 1. Add new store variables
code = code.replace(
  '    setOrderAlert,',
  '    setOrderAlert,\n    orderQueue,\n    enqueueOrderAlert,\n    dequeueOrderAlert,\n    removeOrderFromQueue,'
);

// 2. Change sock.on("new_order_alert")
code = code.replace(
  `      rememberHandledOrderAlert(data.orderId);
      Vibration.vibrate([0, 500, 200, 500]);
      playAppSound('new_order');
      showOrderNotification(data.orderId, data.pickupAddress, data.pricePerKm || 80);
      setOrderAlert(data);
      setAlertTimer(30);`,
  `      rememberHandledOrderAlert(data.orderId);
      useDriverStore.getState().enqueueOrderAlert(data);`
);

// 3. Change sock.on("order_taken")
code = code.replace(
  `    sock.on("order_taken", (data: any) => {
      // Instantly dismiss order modal if taken by another driver
      const currentAlert = useDriverStore.getState().orderAlert;
      if (currentAlert && currentAlert.orderId === data.orderId) {
        clearIncomingOrderAlert(data.orderId);
      }
    });`,
  `    sock.on("order_taken", (data: any) => {
      // Instantly dismiss order modal if taken by another driver
      const state = useDriverStore.getState();
      if (state.orderAlert && state.orderAlert.orderId === data.orderId) {
        clearIncomingOrderAlert(data.orderId);
      } else {
        state.removeOrderFromQueue(data.orderId);
      }
    });`
);

// 4. Add the queue processing useEffect and modify the orderAlert useEffect
const oldOrderAlertEffect = `  useEffect(() => {
    if (orderAlert) {
      timerRef.current = setInterval(() => {
        setAlertTimer((prev) => {
          if (prev <= 1) {
            clearIncomingOrderAlert(orderAlert.orderId);
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [clearIncomingOrderAlert, orderAlert]);`;

const newOrderAlertEffect = `  // Process the order queue
  useEffect(() => {
    if (!orderAlert && orderQueue && orderQueue.length > 0) {
      dequeueOrderAlert();
    }
  }, [orderAlert, orderQueue, dequeueOrderAlert]);

  useEffect(() => {
    if (orderAlert) {
      // Play sound and vibrate when a new order appears on screen
      Vibration.vibrate([0, 500, 200, 500]);
      playAppSound('new_order');
      showOrderNotification(orderAlert.orderId, orderAlert.pickupAddress, orderAlert.pricePerKm || 80);
      setAlertTimer(30);

      timerRef.current = setInterval(() => {
        setAlertTimer((prev) => {
          if (prev <= 1) {
            clearIncomingOrderAlert(orderAlert.orderId);
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [clearIncomingOrderAlert, orderAlert]);`;

code = code.replace(oldOrderAlertEffect, newOrderAlertEffect);

fs.writeFileSync('driver-app/app/index.tsx', code);
console.log('Patched order queue in index.tsx');
