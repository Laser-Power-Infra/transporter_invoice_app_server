async function test() {
  try {
    const res = await fetch('http://localhost:4000/api/data');
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('Success:', json.success);
    console.log('Invoices count:', json.invoices ? json.invoices.length : 'none');
    console.log('Purchases count:', json.purchases ? json.purchases.length : 'none');
    if (json.invoices && json.invoices.length > 0) {
      console.log('First Invoice keys:', Object.keys(json.invoices[0]));
      console.log('First Invoice preview:', {
        party_name: json.invoices[0].party_name,
        our_bill_no: json.invoices[0].our_bill_no,
        array: json.invoices[0].array ? json.invoices[0].array.substring(0, 100) : 'none'
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}
test();
