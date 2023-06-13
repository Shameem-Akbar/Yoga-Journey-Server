require("dotenv").config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);

const app = express();
const cors = require('cors');

//middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'Unauthorized Access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'Unauthorized Access' })
        }
        req.decoded = decoded;
        next();
    })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dmqu4oo.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        client.connect();

        const database = client.db("yogaDB");
        const usersCollection = database.collection("users");
        const classesCollection = database.collection("classes");
        const studentClassesCollection = database.collection("studentClasses");
        const paymentCollection = database.collection("payments");

        //jwt token
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '24h' })
            res.send({ token })
        })

        //admin verifying middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }

        //instructor verifying middleware
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }


        //users getting api
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        //users making api
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'user already exists' })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        //admin making api
        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        //verifying admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })

        //instructor making api
        app.patch('/users/instructor/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'instructor'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        //verifying instructor
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ instructor: false })
            }

            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const result = { instructor: user?.role === 'instructor' }
            res.send(result);
        })

        //classes api
        app.get('/classes', async (req, res) => {
            const result = await classesCollection.find().toArray();
            res.send(result);
        })

        //popular class api
        app.get('/popular-classes', async (req, res) => {
            const classes = await classesCollection.find().sort({ enrolledStudents: -1 }).limit(6).toArray();
            res.send(classes);
        })

        //popular instructor api
        app.get('/popular-instructors', async (req, res) => {
            const classes = await classesCollection.find().limit(6).toArray();
            res.send(classes);
        })

        //get class by email for each instructor
        app.get('/my-classes/:email', async (req, res) => {
            try {
                const email = req.params.email;
                console.log(email);
                const classes = await classesCollection.find({ instructorEmail: email }).toArray();
                res.send(classes);
            } catch (error) {
                console.error(error);
            }
        })

        //post new class
        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const newClass = req.body;
            const result = await classesCollection.insertOne(newClass)
            res.send(result);
        })

        //approve class
        app.patch('/classes/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'approved'
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        // Deny class
        app.patch('/classes/:id/deny', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: 'denied'
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // feedback of class
        app.patch('/feedback/:id', async (req, res) => {
            const id = req.params.id;
            const { feedback } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    feedback: feedback,
                },
            };
            const result = await classesCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        //selected classes post api
        app.post('/selected-classes', async (req, res) => {
            const item = req.body;
            const result = await studentClassesCollection.insertOne(item);
            res.send(result);
        })

        //selected class get api for individual student
        app.get('/selected-classes/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await studentClassesCollection.find({ email: email }).toArray();
                res.send(result);
            } catch (error) {
                console.error(error);
            }
        })

        //delete selected class
        app.delete('/selected-classes/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await studentClassesCollection.deleteOne(query);
            res.send(result);
        })

        // create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        //payment related api
        app.post('/payments', verifyJWT, async (req, res) => {
            const { payment, className } = req.body;
            const insertResult = await paymentCollection.insertOne(payment);
            const userEmail = req.decoded.email;
            const deleteResult = await studentClassesCollection.deleteOne({ email: userEmail, className: className });
            const updateResult = await classesCollection.updateOne(
                { className: className },
                { $inc: { enrolledStudents: 1, availableSeats: -1 } })
            res.send({ insertResult, deleteResult, updateResult });
        })

        //paid classes api
        app.get('/payments/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await paymentCollection.find({ email: email }).sort({ date: -1 }).toArray();
                res.send(result);
            } catch (error) {
                console.error(error);
            }
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Boss is sitting');
})

app.listen(port, () => {
    console.log(`Bistro Boss is sitting on Port ${port}`);
})